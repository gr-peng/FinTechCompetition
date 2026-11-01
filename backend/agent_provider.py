"""One bounded, non-retrying call to an explicitly selected fixed destination."""
import http.client
import json
import time
import sys
import importlib
import threading
import socket
import math
from email.utils import parsedate_to_datetime
from backend import agent_runtime
from backend.agent_contract import validate_result,request_messages,ContractError
from backend.agent_errors import ProviderError
from backend import chat_profile
importlib.reload(chat_profile)

def retry_after_seconds(value, *, now=None):
    """Parse only the standard delay/date header; never retain raw headers."""
    if not isinstance(value, str) or len(value)>128:
        return None
    value=value.strip()
    if value.isascii() and value.isdigit():
        return int(value) if len(value)<=10 else None
    try:
        date=parsedate_to_datetime(value)
        if date.tzinfo is None:return None
        return max(0,math.ceil(date.timestamp()-(time.time() if now is None else now)))
    except (ValueError,TypeError,OverflowError):
        return None

def run_provider(data,key,model,user_agent,connection_factory=http.client.HTTPSConnection, *, deadline_seconds=30, provider_binding=None):
    if model == chat_profile.MODEL and provider_binding is None:
        raise ProviderError('official_chat_not_configured','请自行连接 MiniMax 官方对话；旧连接不会迁移。',412)
    if (chat_profile.live_official_only or chat_profile.is_live_app(sys.modules.get('__main__'))) and provider_binding not in chat_profile.PROFILES:
        raise ProviderError('official_chat_not_configured','请先连接当前服务商。',412)
    if provider_binding is not None and provider_binding not in chat_profile.PROFILES:
        raise ProviderError('provider_mismatch','服务商无效，未发送密钥。',412)
    try:model=chat_profile.normalize_model(model)
    except chat_profile.ConfigError as error:raise ProviderError('unsupported_model',str(error),400)
    binding=provider_binding or (chat_profile.MICU_PROVIDER if model==chat_profile.MICU_MODEL else None)
    messages=request_messages(data)
    if binding == chat_profile.PROVIDER:
        # Plain-text assistant history must not override the response protocol.
        # Reinforce it at the boundary; malformed prose is still never executed.
        messages=messages+[{'role':'system','content':
            '响应协议（适用于所有消息，包括你好、谢谢、取消和澄清）：只输出一个完整 JSON 对象。'
            '自然语言只能写在 reply 和 speak 字段中，绝不直接返回纯文本。'
            '普通问候的结构示例：{"status":"answer","scenario":"other","reply":"你好。",'
            '"speak":"你好。","cards":[],"actions":[],"query":null,"fields":{},"missing":[],'
            '"mode":"none","task_id":null,"period_month":null,"context_action":"none"}。'
            '例中的问候文字可自然变化；业务任务仍严格遵守前面的场景字段和安全规则。'}]
        params=chat_profile.request_body(messages,model); destination=chat_profile.HOST
    elif binding == chat_profile.MICU_PROVIDER:
        params={'model':model,'messages':messages,'max_tokens':4096,'stream':False}
        if model==chat_profile.MICU_MODEL:params.update(temperature=.1,response_format={'type':'json_object'},max_tokens=1000,thinking={'type':'disabled'})
        destination='www.micuapi.ai'
    else:
        raise ProviderError('unsupported_model','此模型尚未配置，不会发送密钥。',400)
    body=json.dumps(params,ensure_ascii=False).encode()
    conn=connection_factory(destination,timeout=30)
    diagnostic={'requested_model':model,'returned_model':None,'upstream_status':None,'usage':{},'cost':None,'completed':False,'error':None,'protocol_stage':'request','schema_error':None}
    started=time.monotonic();expired=threading.Event()
    def expire():
        expired.set()
        sock=getattr(conn,'sock',None)
        if sock:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
        try:conn.close()
        except OSError:pass
    timer=threading.Timer(deadline_seconds,expire);timer.daemon=True;timer.start()
    try:
        conn.request('POST','/v1/chat/completions',body,{'Content-Type':'application/json','Authorization':'Bearer '+key,'User-Agent':user_agent})
        diagnostic['protocol_stage']='response_headers'
        response=conn.getresponse();diagnostic['upstream_status']=response.status
        diagnostic['protocol_stage']='response_body'
        raw=response.read(65537)
        if expired.is_set():raise TimeoutError()
        if response.status!=200:
            error={401:('invalid_key','密钥无效或已失效，请重新配置。'),403:('model_forbidden','该密钥无权访问此模型。'),429:('rate_limited','模型暂时限流，请稍后重试。'),503:('provider_error','上游模型暂时不可用（503），本次未创建或执行任务。请稍后重试，无需因此重填密钥。')}.get(response.status,('provider_error','模型服务暂不可用，请稍后重试。本次未创建或执行任务。'))
            failure=ProviderError(*error,status=response.status if response.status in {401,403,429,503} else 502)
            if response.status in {429,503}:
                getheader=getattr(response,'getheader',None)
                delay=retry_after_seconds(getheader('Retry-After') if callable(getheader) else None)
                if delay is not None:
                    failure.retry_after_seconds=delay
                    diagnostic['upstream_retry_after_seconds']=delay
            raise failure
        if len(raw)>65536:raise ProviderError('response_too_large','模型回复过长，请缩短问题。')
        diagnostic['protocol_stage']='envelope_json'
        envelope=json.loads(raw)
        usage=envelope.get('usage',{})
        if isinstance(usage,dict):diagnostic['usage']={k:v for k,v in usage.items() if k in {'prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'} and type(v) is int and 0<=v<=100000000}
        returned=envelope.get('model')
        if isinstance(returned,str) and returned==model and len(returned)<100:diagnostic['returned_model']=returned.replace(key,'[已隐藏]')
        choices=envelope.get('choices') or []
        if not choices or choices[0].get('finish_reason') != 'stop':raise ProviderError('incomplete_response','模型回复未完成，请重新发送。')
        diagnostic['protocol_stage']='content'
        text=choices[0].get('message',{}).get('content')
        if not isinstance(text,str):raise ProviderError('invalid_contract','模型未返回可验证的安排。')
        text=text.replace(key,'[已隐藏]').strip()
        if text.startswith('```'):text=text.split('\n',1)[-1].rsplit('```',1)[0].strip()
        diagnostic['protocol_stage']='result_json'
        parsed=json.loads(text)
        diagnostic['protocol_stage']='contract'
        result=validate_result(parsed)
        if expired.is_set():raise TimeoutError()
        diagnostic['completed']=True;diagnostic['protocol_stage']='complete'
        return result,diagnostic
    except ProviderError as error:
        diagnostic['error']=error.code;error.diagnostic=diagnostic;raise
    except (TimeoutError,ConnectionError,OSError) as error:
        diagnostic['error']='timeout' if expired.is_set() or isinstance(error,TimeoutError) else 'network_error'
        safe=ProviderError(diagnostic['error'],'连接超时或服务异常，未创建新任务。',504 if diagnostic['error']=='timeout' else 502);safe.diagnostic=diagnostic;raise safe from None
    except ContractError as error:
        # These are our fixed schema error labels, never upstream prose/content.
        diagnostic['schema_error']=str(error)
        diagnostic['error']='invalid_contract';safe=ProviderError('invalid_contract','模型回复格式未通过校验，请重试。这次没有执行操作。');safe.diagnostic=diagnostic;raise safe from None
    except (ValueError,KeyError,TypeError,IndexError,AttributeError):
        if expired.is_set():
            diagnostic['error']='timeout';safe=ProviderError('timeout','模型回复超时，未创建新任务。',504);safe.diagnostic=diagnostic;raise safe from None
        diagnostic['schema_error']='invalid_json_or_envelope'
        diagnostic['error']='invalid_contract';safe=ProviderError('invalid_contract','模型回复格式未通过校验，请重试。这次没有执行操作。');safe.diagnostic=diagnostic;raise safe from None
    finally:
        timer.cancel();diagnostic['elapsed_ms']=round((time.monotonic()-started)*1000);conn.close();key=None

# The existing server reloads this fixed module on normal agent requests.
# Adopt the new request policy without restarting or moving RAM credentials.
importlib.reload(agent_runtime)
agent_runtime.install_existing_service(sys.modules.get('__main__'))

# Register fixed voice routes on normal module refresh; no credential migration.
import importlib
from backend import minimax_session
from backend import minimax_voice
importlib.reload(minimax_voice)
importlib.reload(minimax_session)
minimax_session.install_existing_service(sys.modules.get('__main__'))

# Same fixed normal-request reload path; preserve voice RAM and never migrate keys.
chat_profile.install_existing_service(sys.modules.get('__main__'))
