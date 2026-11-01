"""Deliver one fixed local event. Credentials remain only inside this invocation."""
import argparse
import http.client
from http.cookies import SimpleCookie
import json
from pathlib import Path
import sys
import uuid

# Running this file directly otherwise shadows the root demo_events module.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.demo_events import EVENT_TYPES, DemoEventError, validate_scope, validate_request_id

DEFAULT_PORT = 65321


def deliver_event(scope, event, *, port=DEFAULT_PORT, request_id=None, connection_factory=http.client.HTTPConnection):
    validate_scope(scope)
    if event not in EVENT_TYPES or type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('Invalid local event or port')
    request_id = validate_request_id(request_id or str(uuid.uuid4()))
    origin = f'http://127.0.0.1:{port}'

    def request(method, path, body=None, headers=None):
        connection = connection_factory('127.0.0.1', port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            raw = response.read(32769)
            if len(raw) > 32768 or response.status != 200:
                raise RuntimeError('Local event request failed; delivery is not confirmed')
            return json.loads(raw), response.getheader('Set-Cookie')
        finally:
            connection.close()

    session, raw_cookie = request('GET', '/api/session')
    cookies = SimpleCookie()
    cookies.load(raw_cookie or '')
    name = f'finpilot_dot_session_{port}'
    if name not in cookies or not isinstance(session.get('csrf'), str) or not session['csrf']:
        raise RuntimeError('Local session was not established')
    body = json.dumps({'scope': scope, 'event': event, 'request_id': request_id}).encode()
    result, _ = request('POST', '/api/demo/events', body, {
        'Content-Type': 'application/json', 'Origin': origin,
        'Cookie': f'{name}={cookies[name].value}', 'X-CSRF-Token': session['csrf'],
    })
    delivered = result.get('event', {})
    if delivered.get('type') != event or delivered.get('scope') != scope or result.get('mode') != 'local_demo':
        raise RuntimeError('Local delivery receipt was invalid')
    # Never return the cookie, CSRF or model/session configuration to callers/logs.
    return {key: delivered[key] for key in ('id', 'type', 'fixture_id', 'scope')} | {'duplicate': result.get('duplicate') is True}


def main(argv=None):
    parser = argparse.ArgumentParser(description='向已打开的本地 FinPilot 展示投递一次固定演示事件；不连接真实邮箱或身份服务。')
    parser.add_argument('--scope', required=True, help='展示 URL 中的 session 参数，例如 companion-showcase')
    parser.add_argument('--event', required=True, choices=EVENT_TYPES)
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--request-id', help='重复投递使用同一标识以避免新增事件')
    args = parser.parse_args(argv)
    try:
        result = deliver_event(args.scope, args.event, port=args.port, request_id=args.request_id)
    except (ValueError, OSError, RuntimeError, http.client.HTTPException, DemoEventError):
        print('本地事件投递未获确认。请核实服务、端口和展示 scope；不要自动重复投递。', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
