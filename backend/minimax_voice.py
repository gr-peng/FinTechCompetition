"""Bounded MiniMax China TTS transport. Keys enter only as call arguments.

No environment reads, key persistence, logging, retries, voice cloning, or transaction tools.
The host owns user consent, CSRF/session checks, key lifetime and HTTP routing.
"""
import base64
import codecs
import hashlib
import http.client
import json
import re
import socket
import ssl
import threading
import time
import unicodedata

ENDPOINT = "https://api.minimax.cn/v1/t2a_v2"
MODEL = "speech-2.8-turbo"
VOICE_ID = "Chinese (Mandarin)_Warm_Bestie"
VOICE_IDS = frozenset({VOICE_ID, "Chinese (Mandarin)_Warm_Girl", "Chinese (Mandarin)_Sweet_Lady", "Chinese (Mandarin)_Mature_Woman"})
SAMPLE_RATE = 32000
MAX_SPEAK = 600
_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")


class MinimaxVoiceError(Exception):
    def __init__(self, code, message, *, retryable=False, http_status=502):
        self.code, self.message = code, message
        self.retryable, self.http_status = retryable, http_status
        super().__init__(message)

    def as_event(self, request_id):
        return {"type": "error", "request_id": request_id, "code": self.code,
                "message": self.message, "retryable": self.retryable, "text_unaffected": True}


def _error(code, message, **kwargs):
    return MinimaxVoiceError(code, message, **kwargs)


def masked_speak(envelope):
    if isinstance(envelope, str):
        if len(envelope) > 32768:
            raise _error("invalid_envelope", "语音回复格式无效。", http_status=400)
        try:
            envelope = json.loads(envelope)
        except (ValueError, TypeError):
            raise _error("invalid_envelope", "语音回复格式无效。", http_status=400) from None
    if type(envelope) is not dict or "speak" not in envelope:
        raise _error("missing_speak", "没有可播报的 speak 字段。", http_status=400)
    text = envelope["speak"]
    if not isinstance(text, str) or not 1 <= len(text) <= MAX_SPEAK:
        raise _error("invalid_speak", "播报文字需为 1–600 字的字符串。", http_status=400)
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]", " ", text)
    text = re.sub(r"<[^>]*>", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"https?://\S+", "链接已隐藏", text, flags=re.I)
    text = re.sub(r"(?:验证码|校验码|动态码|短信码|安全码|密码|口令|PIN|OTP|CVV|CVC|password|verification\s*code)\s*(?:是|为|is)?\s*[:：=]?[^，。！？；\n,;!?]{0,80}", "验证信息已隐藏", text, flags=re.I)
    text = re.sub(r"\d(?:[\s·•.,‐‑‒–—-]*\d){9,23}", "号码已隐藏", text)
    text = re.sub(r"[零〇一二三四五六七八九幺](?:[\s·•.,‐‑‒–—-]*[零〇一二三四五六七八九幺]){9,23}", "号码已隐藏", text)
    # Provider sound tags are not accepted from model text. No incidental paid voice effects.
    text = re.sub(r"\((?:laughs|chuckle|breath|sighs|crying|coughs|clear-throat|emm|gasps|pant|inhale|exhale|groans|sniffs|snorts|burps|lip-smacking|humming|hissing|sneezes)\)", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()[:MAX_SPEAK]
    if not text:
        raise _error("empty_speak", "没有可播报的文字。", http_status=400)
    return text


def estimate_billable_characters(text):
    """Estimate only: Han=2, other Unicode code points=1; not a balance query."""
    if not isinstance(text, str):
        raise TypeError("text must be a string")
    return sum(2 if 0x3400 <= ord(c) <= 0x4DBF or 0x4E00 <= ord(c) <= 0x9FFF or 0xF900 <= ord(c) <= 0xFAFF or 0x20000 <= ord(c) <= 0x323AF else 1 for c in text)


def estimate_cost(text):
    count = estimate_billable_characters(text)
    return {"billable_characters_estimate": count, "cny_estimate": round(count * 2.0 / 10000, 6),
            "cny_per_10000": 2.0, "is_estimate": True}


class _HTTPSResponse:
    def __init__(self, connection, response):
        self.connection, self.response = connection, response
        self.status = response.status
        self.content_type = response.getheader("Content-Type", "")

    def read_chunk(self):
        return self.response.read1(4096)

    def close(self):
        try:
            sock = self.connection.sock
            if sock:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        finally:
            self.response.close()
            self.connection.close()


def _open_official(payload, api_key, connect_timeout, read_timeout):
    connection = http.client.HTTPSConnection("api.minimax.cn", 443, timeout=connect_timeout,
                                              context=ssl.create_default_context())
    connection.set_debuglevel(0)
    try:
        connection.request("POST", "/v1/t2a_v2", body=payload,
                           headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json",
                                    "Accept": "text/event-stream", "User-Agent": "FinPilot-Voice/1"})
        if connection.sock:
            connection.sock.settimeout(read_timeout)
        return _HTTPSResponse(connection, connection.getresponse())
    except Exception:
        connection.close()
        raise


def _provider_failure(code):
    mapping = {
        1001: ("provider_timeout", "语音服务响应超时。", True),
        1002: ("rate_limited", "语音请求过于频繁，请稍后手动重试。", True),
        1004: ("invalid_key", "MiniMax 密钥无效或没有语音权限。", False),
        1008: ("insufficient_balance", "MiniMax 账户额度不足。", False),
        1026: ("content_rejected", "语音服务未接受这段播报。", False),
    }
    name, message, retryable = mapping.get(code, ("provider_error", "语音服务返回错误。", False))
    return _error(name, message, retryable=retryable)


class _SSE:
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self.buffer, self.lines = "", []

    def feed(self, data, final=False):
        try:
            self.buffer += self.decoder.decode(data, final=final)
        except UnicodeError:
            raise _error("invalid_stream", "语音服务返回的流格式无效。") from None
        if len(self.buffer) > 2 * 1024 * 1024:
            raise _error("stream_too_large", "语音分片超出大小限制。")
        events = []
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            line = line.rstrip("\r")
            if line == "":
                if self.lines:
                    value = "\n".join(self.lines); self.lines = []
                    if value == "[DONE]":
                        events.append(None)
                    else:
                        try:
                            parsed = json.loads(value)
                        except ValueError:
                            raise _error("invalid_json", "语音服务返回不完整或无效的 JSON。") from None
                        if type(parsed) is not dict:
                            raise _error("invalid_json", "语音服务返回的 JSON 结构无效。")
                        events.append(parsed)
            elif line.startswith("data:"):
                self.lines.append(line[5:].lstrip(" "))
                if sum(len(item) for item in self.lines) > 2 * 1024 * 1024:
                    raise _error("stream_too_large", "语音分片超出大小限制。")
            elif line.startswith(":") or line.startswith(("event:", "id:", "retry:")):
                continue
            else:
                raise _error("invalid_stream", "语音服务返回了非流式内容。")
        if final and (self.buffer.strip() or self.lines):
            raise _error("truncated_stream", "语音流未完整结束，文字回复仍可查看。")
        return events


class MinimaxVoiceClient:
    """Reuse one client per RAM session; never retry or replay a reserved request ID."""
    def __init__(self, *, transport=None, connect_timeout=5, read_timeout=10, total_timeout=60,
                 max_audio_bytes=8 * 1024 * 1024, clock=time.monotonic, max_requests=1024):
        self._transport = transport or _open_official
        self.connect_timeout, self.read_timeout, self.total_timeout = connect_timeout, read_timeout, total_timeout
        self.max_audio_bytes, self.clock, self.max_requests = max_audio_bytes, clock, max_requests
        self._seen, self._lock = {}, threading.Lock()

    def stream(self, envelope, *, api_key, request_id, cancel_event=None, voice_id=VOICE_ID):
        if voice_id not in VOICE_IDS: raise _error("invalid_voice", "音色不在可用列表中。", http_status=400)
        text = masked_speak(envelope)
        if not isinstance(api_key, str) or not api_key.strip() or len(api_key) > 8192 or any(c.isspace() for c in api_key):
            raise _error("key_required", "请先在“我的”中连接 MiniMax。", http_status=400)
        if not isinstance(request_id, str) or not _ID.fullmatch(request_id):
            raise _error("invalid_request_id", "语音请求标识无效。", http_status=400)
        cancel = cancel_event if cancel_event is not None else threading.Event()
        if cancel.is_set():
            raise _error("cancelled", "播报已取消。", http_status=499)
        signature = hashlib.sha256((api_key + "\0" + voice_id + "\0" + text).encode("utf-8")).digest()
        with self._lock:
            if request_id in self._seen:
                code = "duplicate_request" if self._seen[request_id] == signature else "request_id_conflict"
                raise _error(code, "这条语音请求已处理，未重复调用计费接口。", http_status=409)
            if len(self._seen) >= self.max_requests:
                raise _error("request_history_full", "当前语音会话请求较多，请重新连接后继续。", http_status=409)
            self._seen[request_id] = signature
        payload = json.dumps({"model": MODEL, "text": text, "stream": True,
                              "stream_options": {"exclude_aggregated_audio": True},
                              "language_boost": "Chinese", "text_normalization_mode": "basic",
                              "voice_setting": {"voice_id": voice_id, "speed": 1, "vol": 1, "pitch": 0},
                              "audio_setting": {"sample_rate": SAMPLE_RATE, "format": "pcm", "channel": 1}},
                             ensure_ascii=False).encode("utf-8")
        response = None; finished = threading.Event(); started = self.clock()
        def watch():
            while not finished.wait(0.05):
                if cancel.is_set() or self.clock() - started > self.total_timeout:
                    if response is not None:
                        try: response.close()
                        except Exception: pass
                    return
        watcher = threading.Thread(target=watch, daemon=True); watcher.start()
        def check():
            if cancel.is_set():
                raise _error("cancelled", "播报已取消。", http_status=499)
            if self.clock() - started > self.total_timeout:
                raise _error("timeout", "语音服务响应超时，请手动重试。", retryable=True)
        try:
            response = self._transport(payload, api_key, self.connect_timeout, self.read_timeout)
            api_key = ""  # Drop our direct reference; caller alone owns credential lifecycle.
            check()
            if response.status != 200:
                name = {401: "invalid_key", 403: "forbidden", 402: "insufficient_balance", 429: "rate_limited"}.get(response.status, "provider_http_error")
                raise _error(name, "MiniMax 语音请求未成功，请检查连接或稍后手动重试。", retryable=response.status == 429 or response.status >= 500)
            content_type = response.content_type.split(";")[0].strip().lower()
            if content_type not in {"text/event-stream", "application/json"}:
                raise _error("invalid_content_type", "语音服务返回的内容类型无效。")
            if content_type == "application/json":
                body = b""
                while True:
                    check(); chunk = response.read_chunk()
                    if not chunk: break
                    body += chunk
                    if len(body) > 65536: raise _error("invalid_stream", "语音服务未返回预期流。")
                try: value = json.loads(body)
                except (ValueError, UnicodeError): raise _error("invalid_json", "语音服务返回无效内容。") from None
                code = value.get("base_resp", {}).get("status_code") if type(value) is dict and type(value.get("base_resp")) is dict else None
                if type(code) is int and code != 0: raise _provider_failure(code)
                raise _error("expected_stream", "语音服务未返回流式音频。")
            yield {"type": "start", "request_id": request_id, "format": "pcm_s16le", "sample_rate": SAMPLE_RATE,
                   "channels": 1, "model": MODEL, "voice": voice_id, "estimate": estimate_cost(text)}
            parser = _SSE(); audio = bytearray(); carry = b""; sequence = 0; terminal = False; wire_bytes = 0
            while True:
                check(); chunk = response.read_chunk(); check()
                wire_bytes += len(chunk)
                if wire_bytes > self.max_audio_bytes * 3 + 1024 * 1024:
                    raise _error("stream_too_large", "语音流超出大小限制。")
                events = parser.feed(chunk, final=not chunk)
                for event in events:
                    if event is None:
                        if not terminal: raise _error("truncated_stream", "语音流缺少完成标记。")
                        continue
                    base = event.get("base_resp")
                    if base is not None:
                        if type(base) is not dict or type(base.get("status_code")) is not int:
                            raise _error("invalid_response", "语音服务返回状态无效。")
                        if base["status_code"] != 0: raise _provider_failure(base["status_code"])
                    data = event.get("data")
                    if data is None: continue
                    if terminal: raise _error("invalid_stream", "语音完成后出现额外分片。")
                    if type(data) is not dict or type(data.get("status")) is not int or data["status"] not in (1, 2):
                        raise _error("invalid_response", "语音分片状态无效。")
                    info = event.get("extra_info")
                    if info is None: info = {}
                    if type(info) is not dict or info.get("audio_format", "pcm") != "pcm" or info.get("audio_sample_rate", SAMPLE_RATE) != SAMPLE_RATE or info.get("audio_channel", 1) != 1:
                        raise _error("invalid_audio_format", "语音服务返回了不匹配的音频格式。")
                    usage = info.get("usage_characters")
                    if usage is not None and (type(usage) is not int or usage < 0):
                        raise _error("invalid_response", "语音服务返回的用量格式无效。")
                    encoded = data.get("audio", "") or ""
                    if not isinstance(encoded, str) or len(encoded) % 2 or not re.fullmatch(r"[0-9a-fA-F]*", encoded):
                        raise _error("invalid_audio", "语音分片编码无效。")
                    raw = bytes.fromhex(encoded)
                    # Discard only a metadata-confirmed aggregate; repeating silent PCM is valid incremental audio.
                    if data["status"] == 2 and audio and raw.startswith(audio) and type(info.get("audio_size")) is int and info["audio_size"] == len(raw):
                        raw = raw[len(audio):]
                    if not audio and raw.startswith((b"RIFF", b"ID3", b"fLaC", b"OggS")):
                        raise _error("invalid_audio_format", "语音格式与 PCM 请求不匹配。")
                    if len(audio) + len(raw) > self.max_audio_bytes:
                        raise _error("audio_too_large", "本次播报超过长度限制。")
                    audio.extend(raw)
                    aligned = carry + raw; carry = aligned[-1:] if len(aligned) % 2 else b""
                    aligned = aligned[:len(aligned) - len(carry)]
                    for offset in range(0, len(aligned), 6400):
                        check(); block = aligned[offset:offset + 6400]
                        yield {"type": "audio", "request_id": request_id, "seq": sequence,
                               "audio_base64": base64.b64encode(block).decode("ascii")}
                        sequence += 1
                    if data["status"] == 2:
                        if not audio or carry: raise _error("incomplete_audio", "语音音频不完整。")
                        terminal = True
                        result = {"type": "end", "request_id": request_id, "frames": sequence, "audio_bytes": len(audio),
                                  "elapsed_ms": round((self.clock() - started) * 1000, 2), "usage_characters": usage,
                                  "estimate": estimate_cost(text)}
                if not chunk: break
            if not terminal: raise _error("truncated_stream", "语音流未完整结束，文字回复仍可查看。")
            check(); yield result
        except MinimaxVoiceError:
            raise
        except (TimeoutError, socket.timeout):
            check(); raise _error("timeout", "语音服务响应超时，请手动重试。", retryable=True) from None
        except GeneratorExit:
            raise
        except Exception:
            check(); raise _error("transport_error", "语音连接中断，文字回复仍可查看。", retryable=True) from None
        finally:
            api_key = ""; finished.set()
            if response is not None:
                try: response.close()
                except Exception: pass
