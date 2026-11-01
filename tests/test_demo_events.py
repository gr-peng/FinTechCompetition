"""Fixed event queue and protected loopback route; no real model/mail/identity IO."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import http.client
import importlib.util
import json
from pathlib import Path
import threading
import unittest

from backend import demo_events

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('demo_events_test_server', ROOT / 'server.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
spec = importlib.util.spec_from_file_location('demo_events_cli_test', ROOT / 'tools' / 'demo_events.py')
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class DemoQueueTests(unittest.TestCase):
    def setUp(self):
        self.queue = demo_events.DemoEventQueue(now=lambda: datetime(2026, 11, 2, 1, tzinfo=timezone.utc))

    def test_only_allowlisted_fixed_public_events_are_accepted(self):
        for event_type in demo_events.EVENT_TYPES:
            event = self.queue.publish('showcase', event_type)['event']
            self.assertEqual(event['type'], event_type)
            self.assertEqual(event['occurred_at'], '2026-11-02T01:00:00.000Z')
            self.assertEqual(event['source'], {'kind': 'program', 'mode': 'local_demo'})
            if event_type.startswith('voice_'):
                self.assertIs(event['data']['identity_verified'], False)
        with self.assertRaises(demo_events.DemoEventError):
            self.queue.publish('showcase', 'https://untrusted.invalid/send')
        self.assertEqual(len(self.queue.poll('showcase')['events']), len(demo_events.EVENT_TYPES))

    def test_clock_events_have_only_fixed_targets_and_duplicate_delivery_does_not_advance_again(self):
        targets = {'advance_birthday_clock': '2026-11-09T05:14:00Z',
                   'advance_subscription_clock': '2026-11-28T01:00:00Z'}
        for event_type, target in targets.items():
            first = self.queue.publish('showcase', event_type, event_type)
            second = self.queue.publish('showcase', event_type, event_type)
            self.assertFalse(first['duplicate']); self.assertTrue(second['duplicate'])
            self.assertEqual(first['event'], second['event'])
            self.assertEqual(first['event']['data'], {'target_at': target})
            # Callers may edit their copy, but neither the trusted fixture nor
            # later poll/delivery can be retargeted through that mutable copy.
            first['event']['data']['target_at'] = '2099-01-01T00:00:00Z'
            self.assertEqual(self.queue.publish('showcase', event_type, event_type)['event']['data'], {'target_at': target})
        self.assertEqual(len(self.queue.poll('showcase')['events']), 2)

    def test_duplicate_request_has_identical_id_data_and_time_without_a_second_delivery(self):
        first = self.queue.publish('showcase', 'rent_due', 'same-request')
        second = self.queue.publish('showcase', 'rent_due', 'same-request')
        self.assertFalse(first['duplicate']); self.assertTrue(second['duplicate'])
        self.assertEqual(first['event'], second['event'])
        self.assertEqual(len(self.queue.poll('showcase')['events']), 1)
        with self.assertRaises(demo_events.DemoEventError) as raised:
            self.queue.publish('showcase', 'voice_matched', 'same-request')
        self.assertEqual(raised.exception.status, 409)

    def test_scope_isolation_applies_to_events_idempotency_and_cursors(self):
        a = self.queue.publish('scope-a', 'rent_due', 'shared-id')['event']
        b = self.queue.publish('scope-b', 'voice_unknown', 'shared-id')['event']
        self.assertNotEqual(a['id'], b['id'])
        self.assertEqual([event['type'] for event in self.queue.poll('scope-a')['events']], ['rent_due'])
        self.assertEqual([event['type'] for event in self.queue.poll('scope-b')['events']], ['voice_unknown'])
        self.assertEqual(self.queue.poll('scope-empty')['events'], [])
        with self.assertRaises(demo_events.DemoEventError):
            self.queue.poll('scope-b', a['id'])

    def test_poll_is_non_consuming_and_cursor_yields_only_new_events(self):
        first = self.queue.publish('showcase', 'rent_due')['event']
        snapshot = self.queue.poll('showcase')
        self.assertEqual(self.queue.poll('showcase'), snapshot)
        self.assertEqual(self.queue.poll('showcase', snapshot['cursor'])['events'], [])
        second = self.queue.publish('showcase', 'subscription_due')['event']
        self.assertEqual(self.queue.poll('showcase', first['id'])['events'], [second])
        self.assertEqual(self.queue.poll('showcase', '1')['events'], [second])

    def test_callers_cannot_mutate_queued_fixture_data_through_publish_or_poll(self):
        delivered = self.queue.publish('showcase', 'rent_due', 'immutable')['event']
        delivered['data']['amount_minor'] = 1
        polled = self.queue.poll('showcase'); polled['events'][0]['source']['kind'] = 'user'
        again = self.queue.publish('showcase', 'rent_due', 'immutable')['event']
        self.assertEqual(again['data']['amount_minor'], 350000)
        self.assertEqual(again['source']['kind'], 'program')

    def test_scope_request_and_cursor_validation_reject_ambiguous_or_injected_values(self):
        for scope in ('', 'a' * 31, 'has space', '../scope', 'scope?x=1', '中文', None, 2):
            with self.subTest(scope=scope), self.assertRaises(demo_events.DemoEventError):
                self.queue.publish(scope, 'rent_due')
        for request_id in ('', 'x' * 65, 'id/other', 5):
            with self.subTest(request_id=request_id), self.assertRaises(demo_events.DemoEventError):
                self.queue.publish('showcase', 'rent_due', request_id)
        for cursor in ('-1', '1.5', 'other:1', '1', '', None):
            with self.subTest(cursor=cursor), self.assertRaises(demo_events.DemoEventError):
                self.queue.poll('showcase', cursor)

    def test_memory_is_bounded_without_silently_dropping_existing_delivery_receipts(self):
        queue = demo_events.DemoEventQueue(max_scopes=1, max_events=1)
        first = queue.publish('showcase', 'rent_due', 'original')
        for scope in ('showcase', 'other'):
            with self.assertRaises(demo_events.DemoEventError) as raised:
                queue.publish(scope, 'voice_unknown', 'second')
            self.assertEqual(raised.exception.status, 429)
        self.assertEqual(queue.publish('showcase', 'rent_due', 'original')['event'], first['event'])

    def test_concurrent_repeated_delivery_is_atomic(self):
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(lambda _: self.queue.publish('showcase', 'rent_due', 'concurrent'), range(32)))
        self.assertEqual(sum(not result['duplicate'] for result in results), 1)
        self.assertEqual(len({result['event']['id'] for result in results}), 1)
        self.assertEqual(len(self.queue.poll('showcase')['events']), 1)


class DemoEventHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.FinPilotHTTPServer(('127.0.0.1', 0), app.Handler)
        app.PORT = cls.server.server_port
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.previous_queue = demo_events.QUEUE
        demo_events.QUEUE = demo_events.DemoEventQueue()
        app.SESSIONS.clear()
        status, headers, data = self.request('GET', '/api/session', authenticated=False)
        self.assertEqual(status, 200)
        self.cookie = headers['Set-Cookie'].split(';')[0]
        self.csrf = data['csrf']

    def tearDown(self):
        demo_events.QUEUE = self.previous_queue

    def request(self, method, path, data=None, *, authenticated=True, headers=None, raw=None):
        actual = {'Origin': f'http://127.0.0.1:{app.PORT}'}
        if authenticated:
            actual.update({'Cookie': self.cookie, 'X-CSRF-Token': self.csrf})
        actual.update(headers or {})
        actual = {key: value for key, value in actual.items() if value is not None}
        if data is not None:
            raw = json.dumps(data).encode()
            actual.setdefault('Content-Type', 'application/json')
        connection = http.client.HTTPConnection('127.0.0.1', app.PORT, timeout=3)
        try:
            connection.request(method, path, raw, actual)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), json.loads(response.read())
        finally:
            connection.close()

    def publish(self, **options):
        return self.request('POST', '/api/demo/events', {'scope': 'showcase', 'event': 'rent_due', 'request_id': 'one'}, **options)

    def test_poll_and_publish_require_a_valid_local_session(self):
        self.assertEqual(self.request('GET', '/api/demo/events?scope=showcase', authenticated=False)[0], 401)
        self.assertEqual(self.publish(authenticated=False)[0], 401)
        self.assertEqual(self.request('GET', '/api/demo/events?scope=showcase')[2]['events'], [])

    def test_publish_requires_exact_origin_csrf_and_host_before_enqueue(self):
        for headers in ({'Origin': None}, {'Origin': 'https://untrusted.invalid'}, {'X-CSRF-Token': None},
                        {'X-CSRF-Token': 'wrong'}, {'Host': 'untrusted.invalid'}):
            with self.subTest(headers=list(headers)):
                self.assertEqual(self.publish(headers=headers)[0], 403)
        self.assertEqual(demo_events.QUEUE.poll('showcase')['events'], [])

    def test_poll_rejects_cross_origin_but_allows_authenticated_same_origin_without_origin_header(self):
        self.assertEqual(self.request('GET', '/api/demo/events?scope=showcase', headers={'Origin': 'https://untrusted.invalid'})[0], 403)
        self.assertEqual(self.request('GET', '/api/demo/events?scope=showcase', headers={'Origin': None})[0], 200)

    def test_http_duplicate_and_scope_cursor_contract(self):
        status, _, first = self.publish(); self.assertEqual(status, 200)
        status, _, second = self.publish(); self.assertEqual(status, 200)
        self.assertTrue(second['duplicate']); self.assertEqual(first['event'], second['event'])
        status, _, polled = self.request('GET', '/api/demo/events?scope=showcase&after=0')
        self.assertEqual(status, 200); self.assertEqual(polled['events'], [first['event']])
        self.assertEqual(self.request('GET', '/api/demo/events?scope=showcase&after=' + polled['cursor'])[2]['events'], [])
        self.assertEqual(self.request('GET', '/api/demo/events?scope=other')[2]['events'], [])
        status, _, _ = self.request('POST', '/api/demo/events', {'scope': 'showcase', 'event': 'voice_unknown', 'request_id': 'one'})
        self.assertEqual(status, 409)

    def test_external_payload_urls_authority_flags_and_invalid_events_are_rejected(self):
        for extra in ({'payload': {'amount_minor': 1}}, {'url': 'https://untrusted.invalid'}, {'authorized': True},
                      {'event': 'arbitrary'}, {'scope': '../other'}, {'event': {'type': 'rent_due'}}):
            status, _, _ = self.request('POST', '/api/demo/events', {'scope': 'showcase', 'event': 'rent_due', **extra})
            self.assertEqual(status, 400)
        self.assertEqual(demo_events.QUEUE.poll('showcase')['events'], [])

    def test_clock_http_events_cannot_accept_arbitrary_targets_objects_or_authority(self):
        for event_type in ('advance_birthday_clock', 'advance_subscription_clock'):
            for extra in ({'target_at': '2099-01-01T00:00:00Z'}, {'task_id': 'other-task'},
                          {'data': {'target_at': '2099-01-01T00:00:00Z'}}, {'authorized': True}):
                with self.subTest(event=event_type, extra=extra):
                    status, _, _ = self.request('POST', '/api/demo/events',
                        {'scope': 'showcase', 'event': event_type, **extra})
                    self.assertEqual(status, 400)
        self.assertEqual(demo_events.QUEUE.poll('showcase')['events'], [])
        status, _, first = self.request('POST', '/api/demo/events',
            {'scope': 'showcase', 'event': 'advance_birthday_clock', 'request_id': 'clock-once'})
        self.assertEqual(status, 200)
        self.assertEqual(first['event']['data'], {'target_at': '2026-11-09T05:14:00Z'})
        status, _, second = self.request('POST', '/api/demo/events',
            {'scope': 'showcase', 'event': 'advance_birthday_clock', 'request_id': 'clock-once'})
        self.assertEqual(status, 200); self.assertTrue(second['duplicate'])
        self.assertEqual(first['event'], second['event'])

    def test_strict_json_size_and_query_contract(self):
        self.assertEqual(self.publish(headers={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('POST', '/api/demo/events', raw=b'[]', headers={'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('POST', '/api/demo/events', raw=b'x' * 2049, headers={'Content-Type': 'application/json'})[0], 400)
        for query in ('scope=showcase&scope=other', 'scope=showcase&url=elsewhere', 'scope=', 'after=0', 'scope=showcase&after=other:0'):
            with self.subTest(query=query):
                self.assertEqual(self.request('GET', '/api/demo/events?' + query)[0], 400)

    def test_fixed_event_delivery_never_creates_model_authority_or_execution_state(self):
        before = dict(app.BUDGET)
        for event_type in demo_events.EVENT_TYPES:
            status, _, result = self.request('POST', '/api/demo/events', {'scope': 'showcase', 'event': event_type})
            self.assertEqual(status, 200)
            self.assertNotIn('grant', result); self.assertNotIn('receipt', result)
        self.assertEqual(app.BUDGET, before)
        self.assertTrue(all(session['key'] is None for session in app.SESSIONS.values()))
        self.assertEqual(len(demo_events.QUEUE.poll('showcase')['events']), len(demo_events.EVENT_TYPES))

    def test_cli_establishes_its_own_session_and_delivers_one_event_without_returning_credentials(self):
        first = cli.deliver_event('cli-showcase', 'subscription_due', port=app.PORT, request_id='cli-request')
        second = cli.deliver_event('cli-showcase', 'subscription_due', port=app.PORT, request_id='cli-request')
        self.assertFalse(first['duplicate']); self.assertTrue(second['duplicate'])
        self.assertEqual(set(first), {'id', 'type', 'fixture_id', 'scope', 'duplicate'})
        self.assertEqual(len(demo_events.QUEUE.poll('cli-showcase')['events']), 1)
        self.assertEqual(demo_events.QUEUE.poll('showcase')['events'], [])


class DemoEventCLITests(unittest.TestCase):
    def test_cli_target_is_fixed_loopback_and_origin_cookie_csrf_stay_internal(self):
        calls, connections = [], []
        class Response:
            status = 200
            def __init__(self, index): self.index = index
            def read(self, _maximum):
                result = {'csrf': 'synthetic-csrf-only'} if self.index == 0 else {
                    'event': {'id': 'showcase:1', 'type': 'rent_due', 'scope': 'showcase', 'fixture_id': 'rent-20261103'},
                    'duplicate': False, 'mode': 'local_demo'}
                return json.dumps(result).encode()
            def getheader(self, _name): return 'finpilot_dot_session_65321=synthetic-cookie-only; HttpOnly' if self.index == 0 else None
        class Connection:
            def __init__(self, host, port, timeout):
                self.index = len(connections); connections.append((host, port, timeout))
            def request(self, method, path, body=None, headers=None): calls.append((method, path, body, headers))
            def getresponse(self): return Response(self.index)
            def close(self): pass
        result = cli.deliver_event('showcase', 'rent_due', request_id='cli-fixed', connection_factory=Connection)
        self.assertEqual(connections, [('127.0.0.1', 65321, 5)] * 2)
        self.assertEqual(calls[0][:2], ('GET', '/api/session'))
        self.assertEqual(calls[1][:2], ('POST', '/api/demo/events'))
        self.assertEqual(calls[1][3]['Origin'], 'http://127.0.0.1:65321')
        self.assertEqual(calls[1][3]['X-CSRF-Token'], 'synthetic-csrf-only')
        self.assertEqual(json.loads(calls[1][2]), {'scope': 'showcase', 'event': 'rent_due', 'request_id': 'cli-fixed'})
        self.assertNotIn('synthetic', json.dumps(result)); self.assertNotIn('csrf', json.dumps(result))

    def test_invalid_local_cli_arguments_fail_before_any_connection(self):
        def forbidden(*_args, **_kwargs): raise AssertionError('Unexpected connection')
        for options in ({'scope': '../scope', 'event': 'rent_due'}, {'scope': 'showcase', 'event': 'arbitrary'},
                        {'scope': 'showcase', 'event': 'rent_due', 'port': 0}, {'scope': 'showcase', 'event': 'rent_due', 'port': True}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                cli.deliver_event(**options, connection_factory=forbidden)


if __name__ == '__main__':
    unittest.main()
