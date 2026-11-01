"""Agent request policy, independent of the lifetime usage counter.

The fixed provider reload can adopt this handler on the already-running local
service. It preserves the original session/budget objects and never migrates,
enumerates, serializes, or inspects their credentials.
"""
import importlib
import json
from pathlib import Path
import time
from backend import chat_profile


def health(host):
    return {
        'status': 'ok', 'service': 'finpilot-companion-local',
        'bank_connected': False, 'external_api_enabled': host['ALLOW_API'],
        'agent_validation_enabled': host['AGENT_VALIDATION'],
        'agent_call_limit': None, 'agent_request_policy': 'no-total-cap-v1',
        'model': host['MODEL'], 'budget': dict(host['BUDGET']),
        'last_request': host['LAST_DIAGNOSTIC'],
    }


def request(handler, sess, host):
    managed=host['MODEL']==chat_profile.MODEL or 'active_chat_provider' in sess
    profile=chat_profile.selected(sess) if managed else None
    model=profile['model'] if managed else host['MODEL']
    if managed and not chat_profile.configured(sess):
        return handler.reply({'code': 'model_not_configured', 'message': '请在“我的 → 模型与连接”自行填写当前 '+profile['label']+' 的对话 Key；其他服务和语音连接不会复用。'}, 412)
    if not host['AGENT_VALIDATION'] or not host['ALLOW_API'] or not (chat_profile.configured(sess) if managed else sess.get('key')):
        return handler.reply({'code': 'model_not_configured', 'message': '尚未连接模型，请在“模型与连接”检查本次连接。这条消息未调用模型。'}, 412)
    data = handler.payload(64000)
    if data.get('validation_scope') != 'finpilot-fifteen-v1':
        return handler.reply({'code': 'scope_required', 'message': '此接口仅用于当前 FinPilot 场景。'}, 400)
    contract = host['agent_contract']
    try:
        contract.request_messages(data)
    except contract.ContractError:
        return handler.reply({'code': 'invalid_context', 'message': '只读查询或新任务输入无效，未调用模型。'}, 400)
    with host['LOCK']:
        if sess.get('agent_busy'):
            return handler.reply({'code': 'request_in_progress', 'message': '上一条回复仍在处理中，请稍候。'}, 429)
        remaining = sess.get('agent_retry_after', 0) - time.monotonic()
        if remaining > 0:
            seconds = max(1, int(remaining + .999))
            return handler.reply({'code': 'retry_later', 'message': f'连接暂忙，请在 {seconds} 秒后重试。此次未调用模型。', 'retry_after_seconds': seconds}, 429)
        sess['agent_busy'] = True
        # Historical totals remain monotonic. No quota is inferred from them.
        budget = host['BUDGET']
        budget['agent_requests'] = budget.get('agent_requests', 0) + 1
        budget['requests'] += 1
        try:
            host['BUDGET_FILE'].parent.mkdir(exist_ok=True)
            host['BUDGET_FILE'].write_text(json.dumps(budget), encoding='utf-8')
        except OSError:
            sess['agent_busy'] = False
            return handler.reply({'code': 'usage_record_unavailable', 'message': '用量记录暂不可写，未调用模型。'}, 503)
    key = chat_profile.credential(sess,profile['id']) if managed else sess['key']
    diagnostic = {'requested_model': model, 'completed': False, 'usage': {}, 'cost': None}
    try:
        # Existing, fixed local code reload only. No debug/maintenance endpoint.
        with host['AGENT_CODE_LOCK']:
            importlib.invalidate_caches()
            importlib.reload(contract)
            provider = importlib.reload(host['agent_provider'])
            run_provider = provider.run_provider
        # Do not serialize slow upstream IO across otherwise independent sessions.
        options={'connection_factory':host['http'].client.HTTPSConnection}
        if managed:
            # Only an explicitly saved official chat connection may select this path.
            # Recheck after the fixed module refresh; an old in-flight key cannot migrate.
            if not chat_profile.configured(sess) or chat_profile.selected(sess)['id']!=profile['id']:
                raise provider.ProviderError('model_not_configured','当前服务连接已变化，请重新核对；其他服务的 Key 不会复用。',412)
            options['provider_binding']=profile['id']
        result, diagnostic = run_provider(data, key, model, host['UPSTREAM_UA'], **options)
        with host['LOCK']:
            sess.pop('agent_retry_after', None)
            sess.pop('agent_transient_failures', None)
        host['LAST_DIAGNOSTIC'] = diagnostic
        return handler.reply({'result': result, 'provider': diagnostic, 'source': 'llm'})
    except host['agent_provider'].ProviderError as error:
        diagnostic = getattr(error, 'diagnostic', diagnostic)
        host['LAST_DIAGNOSTIC'] = diagnostic
        # No automatic retries. A failed upstream call establishes a short
        # per-session cooldown; rejected repeat clicks do not consume requests.
        if error.code in {'rate_limited', 'timeout', 'network_error', 'provider_error'}:
            with host['LOCK']:
                failures = min(4, sess.get('agent_transient_failures', 0) + 1)
                sess['agent_transient_failures'] = failures
                delay = min(60, (15 if error.code == 'rate_limited' else 5) * 2 ** (failures - 1))
                upstream_delay = getattr(error, 'retry_after_seconds', None)
                if type(upstream_delay) is int and upstream_delay >= 0:
                    delay = max(delay, upstream_delay)
                sess['agent_retry_after'] = time.monotonic() + delay
            return handler.reply({'code': error.code, 'message': error.message + f' 请等待 {delay} 秒后手动重试。', 'retry_after_seconds': delay}, 429 if error.code == 'rate_limited' else error.status)
        return handler.reply({'code': error.code, 'message': error.message}, error.status)
    except (SyntaxError, ImportError):
        diagnostic['error'] = 'local_agent_code_error'
        return handler.reply({'code': 'local_agent_code_error', 'message': '本地模型模块暂不可用，未创建新任务。'}, 503)
    finally:
        key = None
        with host['LOCK']:
            sess['agent_busy'] = False
            record = {k: diagnostic.get(k) for k in ('requested_model', 'returned_model', 'upstream_status', 'upstream_retry_after_seconds', 'usage', 'cost', 'completed', 'error', 'elapsed_ms', 'protocol_stage', 'schema_error')}
            record['recorded_at'] = round(time.time())
            with (host['BUDGET_FILE'].parent / 'agent-usage.jsonl').open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + '\n')


def install_existing_service(module):
    """Adopt new policy only in this exact app through its fixed reload path.

    The retired 40 constant is left untouched in an old process so an already
    entered legacy frame cannot compare its counter to None. New handlers do not
    consult it. The health endpoint reports the policy of the active handler.
    """
    if module is None:
        return False
    host = vars(module)
    root = Path(__file__).resolve().parents[1]
    if (Path(host.get('__file__', '')).resolve() != root / 'server.py'
            or host.get('ROOT') != root
            or host.get('MODEL') != 'deepseek-v4-flash-0731'
            or host.get('BASE') != 'https://www.micuapi.ai/v1'):
        return False
    cls = host.get('Handler')
    if cls is None or cls.server_version != 'FinPilotLocal':
        return False
    if getattr(cls.agent_validation_request, '_finpilot_request_policy', None) == 'no-total-cap-v1':
        return False
    if not host.get('AGENT_VALIDATION') or not host.get('ALLOW_API'):
        return False
    old_get = cls.do_GET

    def current_request(self, sess):
        return request(self, sess, host)

    def current_get(self):
        if self.path == '/api/health' and self.valid_host():
            return self.reply(health(host))
        return old_get(self)

    current_request._finpilot_request_policy = 'no-total-cap-v1'
    cls.agent_validation_request = current_request
    cls.do_GET = current_get
    return True
