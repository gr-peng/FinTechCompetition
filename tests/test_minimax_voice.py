import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("minimax_voice", Path(__file__).resolve().parents[1] / "backend" / "minimax_voice.py")
voice = importlib.util.module_from_spec(spec); spec.loader.exec_module(voice)
MOCK_KEY = "test-not-a-real-minimax-key"
PCM = b"\x00\x00\x01\x00\xff\x7f\x00\x80"


def packet(status=1, audio=PCM, **extra):
    return ("data: " + json.dumps({"base_resp": {"status_code": 0}, "data": {"status": status, "audio": audio.hex()}, **extra}, ensure_ascii=False) + "\n\n").encode()


def complete(audio=PCM):
    return packet(1, audio) + packet(2, b"", extra_info={"audio_format": "pcm", "audio_sample_rate": 32000, "audio_channel": 1, "usage_characters": 12})


class Response:
    status = 200
    content_type = "text/event-stream; charset=utf-8"

    def __init__(self, wire=None, chunks=None, status=200, content_type=None):
        self.chunks = list(chunks if chunks is not None else [complete() if wire is None else wire])
        self.closed = False; self.reads = 0; self.status = status
        if content_type: self.content_type = content_type

    def read_chunk(self):
        self.reads += 1
        return self.chunks.pop(0) if self.chunks else b""

    def close(self): self.closed = True


def harness(response=None, **options):
    calls = []; response = response or Response()
    def transport(payload, key, connect_timeout, read_timeout):
        calls.append({"payload": json.loads(payload), "key": key, "timeouts": (connect_timeout, read_timeout)})
        return response
    return voice.MinimaxVoiceClient(transport=transport, **options), response, calls


class ContractTests(unittest.TestCase):
    def test_only_top_level_speak_is_selected_and_sensitive_text_is_scrubbed(self):
        for value in (None, [], "bad json", {"reply": "hello"}, {"speak": []}, {"speak": "x" * 601}):
            with self.subTest(value=str(value)[:30]), self.assertRaises(voice.MinimaxVoiceError):
                voice.masked_speak(value)
        envelope = {"speak": "卡号6222 1234 5678 9999，验证码123456。<break/>你好(laughs)。", "reply": "never read", "actions": [{"execute": "anything"}]}
        safe = voice.masked_speak(envelope)
        for secret in ("6222", "9999", "123456", "never read", "laughs", "break"):
            self.assertNotIn(secret, safe)
        self.assertIn("你好", safe)

    def test_estimates_count_han_twice_and_never_claim_a_balance(self):
        self.assertEqual(voice.estimate_billable_characters("你好A🙂"), 6)
        result = voice.estimate_cost("你好A🙂")
        self.assertEqual(result["cny_estimate"], .0012)
        self.assertTrue(result["is_estimate"]); self.assertNotIn("balance", result)

    def test_payload_is_fixed_and_first_audio_is_yielded_before_upstream_finishes(self):
        response = Response(chunks=[packet(1), packet(2, b"")]); client, _, calls = harness(response)
        stream = client.stream({"speak": "你好", "actions": ["transfer"]}, api_key=MOCK_KEY, request_id="first")
        self.assertEqual(next(stream)["type"], "start"); first = next(stream)
        self.assertEqual(first["type"], "audio"); self.assertEqual(response.reads, 1)
        events = list(stream); self.assertEqual(events[-1]["type"], "end"); self.assertTrue(response.closed)
        payload = calls[0]["payload"]
        self.assertEqual(payload["model"], "speech-2.8-turbo")
        self.assertEqual(payload["voice_setting"]["voice_id"], "Chinese (Mandarin)_Warm_Bestie")
        self.assertEqual(payload["audio_setting"], {"sample_rate": 32000, "format": "pcm", "channel": 1})
        self.assertTrue(payload["stream_options"]["exclude_aggregated_audio"])
        self.assertNotIn("actions", payload); self.assertNotIn("key", payload)

    def test_utf8_and_sse_json_can_span_network_chunks(self):
        wire = b": heartbeat\r\n\r\n" + complete()
        client, _, _ = harness(Response(chunks=[wire[i:i+3] for i in range(0, len(wire), 3)]))
        events = list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="split"))
        self.assertEqual(events[-1]["audio_bytes"], len(PCM))

    def test_final_aggregated_audio_is_not_replayed(self):
        client, _, _ = harness(Response(packet(1) + packet(2, PCM, extra_info={"audio_size": len(PCM)})))
        events = list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="aggregate"))
        self.assertEqual(len([e for e in events if e["type"] == "audio"]), 1)
        self.assertEqual(events[-1]["audio_bytes"], len(PCM))

    def test_repeated_incremental_pcm_is_preserved_and_bad_metadata_precedes_playback(self):
        client, _, _ = harness(Response(packet(1) + packet(2, PCM, extra_info={"audio_size": len(PCM)*2})))
        events = list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="silence"))
        self.assertEqual(events[-1]["audio_bytes"], len(PCM)*2)
        client, _, _ = harness(Response(packet(2, PCM, extra_info={"audio_format": "mp3"})))
        stream = client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="metadata")
        self.assertEqual(next(stream)["type"], "start")
        with self.assertRaises(voice.MinimaxVoiceError) as caught: next(stream)
        self.assertEqual(caught.exception.code, "invalid_audio_format")

    def test_odd_pcm_network_boundary_is_carried_then_validated(self):
        client, _, _ = harness(Response(packet(1, PCM[:3]) + packet(2, PCM[3:])))
        events = list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="odd-boundary"))
        self.assertEqual(events[-1]["audio_bytes"], len(PCM))

    def test_duplicate_and_conflicting_ids_never_start_another_billed_request(self):
        client, _, calls = harness()
        list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="same"))
        for text, expected in (("你好", "duplicate_request"), ("另一个", "request_id_conflict")):
            with self.assertRaises(voice.MinimaxVoiceError) as error:
                list(client.stream({"speak": text}, api_key=MOCK_KEY, request_id="same"))
            self.assertEqual(error.exception.code, expected)
        self.assertEqual(len(calls), 1)

    def test_failed_and_cancelled_ids_are_not_automatically_retried(self):
        client, response, calls = harness(Response(status=429))
        for _ in range(2):
            with self.assertRaises(voice.MinimaxVoiceError):
                list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="failed"))
        self.assertEqual(len(calls), 1); self.assertEqual(response.reads, 0)

    def test_missing_key_invalid_id_and_pre_cancel_do_not_call_provider(self):
        client, _, calls = harness(); cancelled = threading.Event(); cancelled.set()
        for key, request_id, event in (("", "x", None), (MOCK_KEY, "not valid", None), (MOCK_KEY, "x", cancelled)):
            with self.assertRaises(voice.MinimaxVoiceError):
                list(client.stream({"speak": "你好"}, api_key=key, request_id=request_id, cancel_event=event))
        self.assertEqual(calls, [])

    def test_http_errors_are_safe_and_do_not_read_provider_error_bodies(self):
        for status, code in ((401, "invalid_key"), (402, "insufficient_balance"), (429, "rate_limited"), (503, "provider_http_error"), (302, "provider_http_error")):
            response = Response(wire=MOCK_KEY.encode(), status=status); client, _, calls = harness(response)
            with self.assertRaises(voice.MinimaxVoiceError) as caught:
                list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id=str(status)))
            self.assertEqual(caught.exception.code, code); self.assertEqual(response.reads, 0)
            self.assertNotIn(MOCK_KEY, str(caught.exception)); self.assertTrue(response.closed); self.assertEqual(len(calls), 1)

    def test_provider_error_codes_in_json_and_sse_are_checked_without_echo(self):
        for code, expected in ((1004, "invalid_key"), (1008, "insufficient_balance"), (1001, "provider_timeout"), (1026, "content_rejected")):
            error = {"base_resp": {"status_code": code, "status_msg": MOCK_KEY}}
            for content_type, wire in (("application/json", json.dumps(error).encode()), ("text/event-stream", ("data: " + json.dumps(error) + "\n\n").encode())):
                client, _, _ = harness(Response(wire, content_type=content_type))
                with self.assertRaises(voice.MinimaxVoiceError) as caught:
                    list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="provider-error"))
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn(MOCK_KEY, json.dumps(caught.exception.as_event("provider-error")))

    def test_malformed_truncated_and_non_pcm_streams_never_report_completion(self):
        bad = [b'data: {"data":\n\n', b'data: {"data":', packet(1), b'data: \xff\n\n',
               packet(2, b""), packet(2, b"\x01"), packet(2, b"RIFF0000"),
               packet(2, PCM, extra_info={"audio_format": "mp3"}), b'data: [DONE]\n\n']
        for index, wire in enumerate(bad):
            client, response, _ = harness(Response(wire))
            with self.subTest(index=index), self.assertRaises(voice.MinimaxVoiceError):
                list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="bad"))
            self.assertTrue(response.closed)

    def test_non_hex_audio_and_late_events_are_rejected(self):
        for wire in (b'data: {"data":{"status":1,"audio":"0q"}}\n\n', complete() + packet(1)):
            client, _, _ = harness(Response(wire))
            with self.assertRaises(voice.MinimaxVoiceError):
                list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="bad-audio"))

    def test_audio_and_request_history_limits_fail_closed(self):
        client, _, _ = harness(max_audio_bytes=2)
        with self.assertRaises(voice.MinimaxVoiceError) as caught:
            list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="large"))
        self.assertEqual(caught.exception.code, "audio_too_large")
        client, _, calls = harness(max_requests=1)
        list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="one"))
        with self.assertRaises(voice.MinimaxVoiceError) as caught:
            list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="two"))
        self.assertEqual(caught.exception.code, "request_history_full"); self.assertEqual(len(calls), 1)

    def test_cancel_closes_pending_response_and_never_continues_to_end(self):
        cancelled = threading.Event(); response = Response(chunks=[packet(1), packet(2, b"")]); client, _, _ = harness(response)
        stream = client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="cancel", cancel_event=cancelled)
        next(stream); next(stream); cancelled.set()
        with self.assertRaises(voice.MinimaxVoiceError) as caught: next(stream)
        self.assertEqual(caught.exception.code, "cancelled"); self.assertTrue(response.closed)

    def test_cancel_interrupts_a_mock_blocked_read(self):
        entered = threading.Event(); closed = threading.Event(); cancelled = threading.Event(); errors = []
        response = Response()
        def read(): entered.set(); closed.wait(2); raise OSError("private network detail")
        response.read_chunk = read
        response.close = lambda: (closed.set(), setattr(response, "closed", True))
        client, _, _ = harness(response)
        def run():
            try: list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="blocked", cancel_event=cancelled))
            except voice.MinimaxVoiceError as error: errors.append(error.code)
        worker = threading.Thread(target=run); worker.start(); self.assertTrue(entered.wait(1)); cancelled.set(); worker.join(1)
        self.assertFalse(worker.is_alive()); self.assertEqual(errors, ["cancelled"])

    def test_read_timeout_and_transport_exceptions_are_safe_without_retry(self):
        for exception, expected in ((TimeoutError(MOCK_KEY), "timeout"), (OSError(MOCK_KEY), "transport_error")):
            calls = []
            def transport(*args): calls.append(1); raise exception
            client = voice.MinimaxVoiceClient(transport=transport)
            with self.assertRaises(voice.MinimaxVoiceError) as caught:
                list(client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="failure"))
            self.assertEqual(caught.exception.code, expected); self.assertNotIn(MOCK_KEY, str(caught.exception)); self.assertEqual(calls, [1])

    def test_generator_close_closes_upstream(self):
        client, response, _ = harness(); stream = client.stream({"speak": "你好"}, api_key=MOCK_KEY, request_id="close")
        next(stream); stream.close(); self.assertTrue(response.closed)

    def test_official_transport_uses_fixed_host_tls_and_path(self):
        class Sock:
            def settimeout(self, value): self.timeout = value
            def shutdown(self, _): pass
        class Connection:
            sock = Sock()
            def set_debuglevel(self, value): self.debug = value
            def request(self, *args, **kwargs): self.request_args = args; self.request_kwargs = kwargs
            def getresponse(self):
                class HTTP:
                    status = 200
                    def getheader(self, *_): return "text/event-stream"
                    def close(self): pass
                return HTTP()
            def close(self): pass
        connection = Connection()
        with patch.object(voice.http.client, "HTTPSConnection", return_value=connection) as factory:
            response = voice._open_official(b"{}", MOCK_KEY, 5, 10)
            self.assertEqual(factory.call_args.args, ("api.minimax.cn", 443))
            self.assertTrue(factory.call_args.kwargs["context"].check_hostname)
            self.assertEqual(connection.request_args[:2], ("POST", "/v1/t2a_v2")); self.assertEqual(connection.debug, 0)
            response.close()


if __name__ == "__main__": unittest.main()
