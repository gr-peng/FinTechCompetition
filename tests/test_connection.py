"""Synthetic same-origin and multi-preview connection regressions; no real API calls."""
import http.cookiejar
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

ROOT = Path(__file__).parents[1]


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.apps = []
        for index in range(2):
            spec = importlib.util.spec_from_file_location('connection_app_' + str(index), ROOT / 'server.py')
            app = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(app)
            app.ALLOW_API = True
            app.AGENT_VALIDATION = True
            app.BUDGET_FILE = Path(self.temp.name) / str(index) / 'budget.json'
            app.BUDGET_FILE.parent.mkdir()
            server = app.FinPilotHTTPServer(('127.0.0.1', 0), app.Handler)
            app.PORT = server.server_port
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.apps.append((app, server))
        self.jar = http.cookiejar.CookieJar()
        self.browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def tearDown(self):
        for _, server in self.apps:
            server.shutdown()
            server.server_close()
        self.temp.cleanup()

    def request(self, index, path, data=None, **headers):
        app, _ = self.apps[index]
        origin = 'http://127.0.0.1:' + str(app.PORT)
        actual = {'Origin': origin, **headers}
        raw = None
        if data is not None:
            raw = json.dumps(data).encode()
            actual['Content-Type'] = 'application/json'
        request = urllib.request.Request(origin + path, data=raw, headers=actual)
        try:
            response = self.browser.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            return response.status, dict(response.headers), json.loads(body) if 'application/json' in response.headers.get('Content-Type', '') else body

    def configure(self, index):
        _, _, session = self.request(index, '/api/session')
        status, _, result = self.request(index, '/api/config', {
            'mode': 'api', 'base_url': self.apps[index][0].BASE, 'key': 'test-not-a-real-credential',
        }, **{'X-CSRF-Token': session['csrf']})
        self.assertEqual(status, 200)
        return session, result

    def test_other_preview_port_cannot_replace_the_saved_connection_cookie(self):
        session, _ = self.configure(0)
        self.request(1, '/api/session')
        status, _, state = self.request(0, '/api/session')
        self.assertEqual(status, 200)
        self.assertTrue(state['configured'])
        self.assertEqual(state['csrf'], session['csrf'])
        self.assertEqual(len(self.jar), 2)

    def test_selected_provider_uses_only_its_own_ram_credential_and_voice_is_unchanged(self):
        session,_=self.configure(0);app=self.apps[0][0];saved=next(iter(app.SESSIONS.values()))
        saved['minimax_key']='synthetic-voice-only';calls=[]
        csrf={'X-CSRF-Token':session['csrf']}
        status,_,state=self.request(0,'/api/config',{'mode':'select','provider':'micu'},**csrf)
        self.assertEqual(status,200);self.assertFalse(state['configured'])
        payload={'validation_scope':'finpilot-fifteen-v1','text':'你好','tool_catalog':[],'run_history':[]}
        class Upstream:
            def __init__(self,host,**kwargs):self.host=host
            def request(self,method,path,body,headers):calls.append((self.host,headers['Authorization']))
            def getresponse(self):
                plan={'status':'answer','scenario':'other','reply':'你好','query':None,'fields':{},'missing':[],'mode':'none','task_id':None}
                model=app.chat_profile.MICU_MODEL if self.host=='www.micuapi.ai' else app.chat_profile.MODEL
                raw=json.dumps({'model':model,'choices':[{'finish_reason':'stop','message':{'content':json.dumps(plan)}}]}).encode()
                class Response:
                    status=200
                    def read(self,n):return raw[:n]
                return Response()
            def close(self):pass
        with patch.object(app.http.client,'HTTPSConnection',Upstream):
            self.assertEqual(self.request(0,'/api/agent',payload,**csrf)[0],412);self.assertEqual(calls,[])
            status,_,state=self.request(0,'/api/config',{'mode':'api','provider':'micu','base_url':app.chat_profile.MICU_BASE,'model':app.chat_profile.MICU_MODEL,'key':'synthetic-micu-only'},**csrf)
            self.assertEqual(status,200);self.assertTrue(state['configured']);self.assertNotIn('synthetic',json.dumps(state))
            self.assertEqual(self.request(0,'/api/agent',payload,**csrf)[0],200)
            self.assertEqual(calls,[('www.micuapi.ai','Bearer synthetic-micu-only')])
            self.assertEqual(self.request(0,'/api/config',{'mode':'select','provider':'minimax-official'},**csrf)[0],200)
            self.assertEqual(self.request(0,'/api/agent',payload,**csrf)[0],200)
            self.assertEqual(calls[-1],('api.minimax.cn','Bearer test-not-a-real-credential'))
        self.assertEqual(saved['minimax_key'],'synthetic-voice-only')
        self.assertEqual(saved['key'],'test-not-a-real-credential')

    def test_session_reports_external_and_planner_readiness_separately(self):
        app = self.apps[0][0]
        app.ALLOW_API = False
        _, _, state = self.request(0, '/api/session')
        self.assertFalse(state['enabled'])
        self.assertFalse(state['agent_enabled'])
        status, _, result = self.request(0, '/api/config', {
            'mode': 'api', 'base_url': app.BASE, 'key': 'test-not-a-real-credential',
        }, **{'X-CSRF-Token': state['csrf']})
        self.assertEqual(status, 412)
        self.assertEqual(result['code'], 'external_api_disabled')
        app.ALLOW_API = True
        _, _, state = self.request(0, '/api/session')
        self.assertTrue(state['agent_enabled'])
        app.AGENT_VALIDATION = False
        _, _, state = self.request(0, '/api/session')
        self.assertTrue(state['enabled'])
        self.assertFalse(state['agent_enabled'])

    def test_iframe_and_standalone_share_same_origin_connection_and_llm_route(self):
        app = self.apps[0][0]
        _, result = self.configure(0)
        self.assertNotIn('key', result)
        for referer in ('/showcase.html?session=judge', '/?app=1&session=judge'):
            status, headers, html = self.request(0, referer)
            self.assertEqual(status, 200)
            self.assertIn("frame-ancestors 'self'", headers['Content-Security-Policy'])
            _, _, state = self.request(0, '/api/session', Referer='http://127.0.0.1:' + str(app.PORT) + referer)
            self.assertTrue(state['configured'])
        plan = {'status':'answer','scenario':'question','reply':'请查看餐饮账目。','query':'dining_month',
                'fields':{},'missing':[],'mode':'none','task_id':None}
        payload = json.dumps({'model':app.MODEL,'choices':[{'finish_reason':'stop','message':{'content':json.dumps(plan)}}]}).encode()
        class Response:
            status = 200
            def read(self, maximum): return payload[:maximum]
        class Upstream:
            def __init__(self, *args, **kwargs): pass
            def request(self, *args, **kwargs): pass
            def getresponse(self): return Response()
            def close(self): pass
        with patch.object(app.http.client, 'HTTPSConnection', Upstream):
            status, _, answer = self.request(0, '/api/agent', {
                'validation_scope':'finpilot-fifteen-v1','text':'本月餐饮','tool_catalog':['dining_month'],'run_history':[],
            }, **{'X-CSRF-Token':state['csrf']})
        self.assertEqual(status, 200)
        self.assertEqual(answer['source'], 'llm')
        self.assertTrue(answer['provider']['completed'])
        self.assertNotIn('test-not-a-real-credential', json.dumps(answer))

    def test_port_scoping_preserves_origin_and_csrf_guards(self):
        state, _ = self.configure(0)
        data = {'mode':'api','base_url':self.apps[0][0].BASE,'key':'test-not-a-real-credential'}
        for headers in ({'Origin':'https://untrusted.invalid','X-CSRF-Token':state['csrf']},
                        {'X-CSRF-Token':'invalid'}):
            status, _, _ = self.request(0, '/api/config', data, **headers)
            self.assertNotEqual(status, 200)
        self.assertTrue(self.request(0, '/api/session')[2]['configured'])

    def test_official_key_cannot_enter_legacy_chat_or_arbitrary_destination(self):
        app=self.apps[0][0]
        session,_=self.configure(0)
        app.AGENT_VALIDATION=False
        with patch.object(app.http.client,'HTTPSConnection') as upstream:
            self.assertEqual(self.request(0,'/api/chat',{'text':'hi'},**{'X-CSRF-Token':session['csrf']})[0],403)
            self.assertEqual(self.request(0,'/api/config',{'mode':'api','base_url':'https://www.micuapi.ai/v1','key':'synthetic-key'},**{'X-CSRF-Token':session['csrf']})[0],400)
        upstream.assert_not_called()

    def test_live_profile_refresh_preserves_voice_but_requires_separate_chat_connection(self):
        app=self.apps[0][0]
        _,_,browser=self.request(0,'/api/session')
        # Entirely synthetic RAM fixture, never an actual user's credentials.
        sess=next(iter(app.SESSIONS.values()))
        voice={'fixture':'voice-state'}
        sess.update(key='synthetic-legacy-key',minimax_key='synthetic-voice-key',voice_fixture=voice)
        app.MODEL='deepseek-flash';app.BASE='https://www.micuapi.ai/v1'
        sessions=app.SESSIONS
        with patch.object(app.chat_profile,'live_official_only',False):
            self.assertTrue(app.chat_profile.install_existing_service(app))
            self.assertIs(app.SESSIONS,sessions)
            self.assertIs(sess['voice_fixture'],voice)
            self.assertEqual(sess['minimax_key'],'synthetic-voice-key')
            self.assertFalse(self.request(0,'/api/session')[2]['configured'])
            self.assertEqual(self.request(0,'/api/session')[2]['provider'],'minimax-official')
            with patch.object(app.http.client,'HTTPSConnection') as upstream:
                self.assertEqual(self.request(0,'/api/agent',{'validation_scope':'finpilot-fifteen-v1','text':'hi'},**{'X-CSRF-Token':browser['csrf']})[0],412)
                with self.assertRaises(app.agent_provider.ProviderError):
                    app.agent_provider.run_provider({},'synthetic-legacy-key',app.MODEL,'test')
            upstream.assert_not_called()
            for headers in ({'Origin':'https://untrusted.invalid','X-CSRF-Token':browser['csrf']},{'X-CSRF-Token':'bad'}):
                self.assertEqual(self.request(0,'/api/config',{'mode':'api','base_url':app.BASE,'key':'synthetic-official-key'},**headers)[0],403)
            self.configure(0)
            self.assertTrue(self.request(0,'/api/session')[2]['configured'])
            self.assertEqual(sess['minimax_key'],'synthetic-voice-key')
            self.assertEqual(sess['chat_provider'],'minimax-official')
