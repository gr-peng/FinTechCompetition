import unittest,threading,json,http.client
import server
from backend import minimax_session

class VoiceConfigTests(unittest.TestCase):
 def test_consent_is_required_and_llm_is_untouched(self):
  s={'key':'existing-dialogue-placeholder'}
  with self.assertRaises(ValueError):minimax_session.configure(s,{'key':'test-voice-placeholder'})
  self.assertNotIn('minimax_key',s)
  result=minimax_session.configure(s,{'key':'test-voice-placeholder','consent':True})
  self.assertEqual(s['key'],'existing-dialogue-placeholder');self.assertTrue(result['configured']);self.assertFalse(result['verified']);self.assertNotIn('key',result)
 def test_disconnect_invalidates_inflight_and_preserves_accounting(self):
  s={'key':'dialogue-placeholder','minimax_characters':120}
  minimax_session.configure(s,{'key':'test-voice-placeholder','consent':True});g=s['minimax_generation'];c=threading.Event();s['minimax_cancel']=c
  minimax_session.configure(s,{'disconnect':True});self.assertTrue(c.is_set());self.assertNotEqual(g,s['minimax_generation']);self.assertNotIn('minimax_key',s);self.assertEqual(s['minimax_characters'],120);self.assertEqual(s['key'],'dialogue-placeholder')
 def test_invalid_inputs_do_not_mutate(self):
  for data in [{'key':'short','consent':True},{'key':'a'*20+'\n','consent':True},{'key':'test-voice-placeholder','consent':True,'url':'https://example.com'}]:
   s={}
   with self.assertRaises(ValueError):minimax_session.configure(s,data)
   self.assertEqual(s,{})
 def test_reconnect_keeps_conservative_usage(self):
  s={'minimax_characters':1800}
  minimax_session.configure(s,{'key':'test-voice-placeholder','consent':True});self.assertEqual(minimax_session.status(s)['estimated_characters'],1800)

class VoiceConfigHTTPTests(unittest.TestCase):
 def setUp(self):
  self.oldport=server.PORT;self.oldsessions=server.SESSIONS;self.oldallow=server.ALLOW_API;server.ALLOW_API=True;server.SESSIONS={}
  self.http=server.FinPilotHTTPServer(('127.0.0.1',0),server.Handler);server.PORT=self.http.server_port
  self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
  self.cookie=None;self.csrf=None
  _,d=self.request('GET','/api/session');self.csrf=d['csrf']
 def tearDown(self):
  self.http.shutdown();self.http.server_close();self.thread.join();server.PORT=self.oldport;server.SESSIONS=self.oldsessions;server.ALLOW_API=self.oldallow
 def request(self,method,path,body=None,csrf=True):
  c=http.client.HTTPConnection('127.0.0.1',server.PORT,timeout=3)
  h={'Origin':f'http://127.0.0.1:{server.PORT}','Content-Type':'application/json'}
  if self.cookie:h['Cookie']=self.cookie
  if self.csrf and csrf:h['X-CSRF-Token']=self.csrf
  c.request(method,path,json.dumps(body) if body is not None else None,h);r=c.getresponse();raw=r.read()
  if r.getheader('Set-Cookie'):self.cookie=r.getheader('Set-Cookie').split(';')[0]
  result=(r.status,json.loads(raw));c.close();return result
 def test_normal_reload_registration_preserves_existing_session_and_routes(self):
  cls=server.Handler;oldget,oldpost=cls.do_GET,cls.do_POST;store=server.SESSIONS
  try:
   self.assertTrue(minimax_session.install_existing_service(server));self.assertFalse(minimax_session.install_existing_service(server));self.assertIs(store,server.SESSIONS)
   code,d=self.request('POST','/api/voice/config',{'key':'test-voice-placeholder','consent':True});self.assertEqual(code,200);self.assertTrue(d['configured'])
   code,d=self.request('GET','/api/health');self.assertEqual(code,200)
  finally:
   cls.do_GET=oldget;cls.do_POST=oldpost;delattr(cls,'_minimax_routes')
 def test_all_four_voice_streams_work_without_any_dialogue_connection(self):
  from unittest.mock import patch
  self.assertFalse(self.request('GET','/api/session')[1]['configured'])
  self.request('POST','/api/voice/config',{'key':'test-voice-placeholder','consent':True})
  seen=[]
  class Client:
   def stream(self,envelope,**kw):
    seen.append(kw['voice_id'])
    yield {'type':'start','request_id':kw['request_id'],'model':'speech-2.8-turbo','voice':kw['voice_id']}
    yield {'type':'audio','request_id':kw['request_id'],'seq':0,'audio_base64':'AAA='}
    yield {'type':'end','request_id':kw['request_id'],'frames':1,'audio_bytes':2}
  with patch('backend.minimax_voice.MinimaxVoiceClient',Client),patch('backend.agent_provider.run_provider',side_effect=AssertionError('Dialogue must not be invoked')):
   for i,voice in enumerate(sorted(minimax_session.VOICES)):
    c=http.client.HTTPConnection('127.0.0.1',server.PORT,timeout=3)
    c.request('POST','/api/voice/minimax/stream',json.dumps({'request_id':'independent-'+str(i),'speak':'你好','voice_id':voice}),{'Origin':f'http://127.0.0.1:{server.PORT}','Cookie':self.cookie,'X-CSRF-Token':self.csrf,'Content-Type':'application/json'})
    r=c.getresponse();self.assertEqual(r.status,200);events=[json.loads(x) for x in r.read().decode().splitlines()];c.close()
    self.assertEqual(events[0]['voice'],voice);self.assertEqual(events[-1]['type'],'end')
  self.assertEqual(set(seen),minimax_session.VOICES)
  self.assertFalse(self.request('GET','/api/session')[1]['configured'])
  self.assertEqual(self.request('GET','/api/voice/config')[1]['voice'],minimax_session.VOICE)
 def test_config_requires_csrf_and_never_echoes_secret(self):
  body={'key':'test-voice-placeholder','consent':True}
  code,_=self.request('POST','/api/voice/config',body,csrf=False);self.assertEqual(code,400);self.assertFalse(self.request('GET','/api/voice/config')[1]['configured'])
  code,d=self.request('POST','/api/voice/config',body);self.assertEqual(code,200);self.assertNotIn(body['key'],json.dumps(d));self.assertFalse(d['verified'])
  code,d=self.request('GET','/api/voice/config');self.assertTrue(d['configured']);self.assertNotIn(body['key'],json.dumps(d))
  code,d=self.request('POST','/api/voice/config',{'disconnect':True});self.assertFalse(d['configured'])


class VoiceStreamTests(unittest.TestCase):
 def setUp(self):
  import sys,types,io
  self.sys=sys;self.old=sys.modules.get('backend.minimax_voice');self.calls=[];self.session={}
  minimax_session.configure(self.session,{'key':'test-voice-placeholder','consent':True})
  owner=self
  class Client:
   def stream(self,envelope,**kw):
    owner.calls.append({'speak':envelope['speak'],'request_id':kw['request_id'],'voice':kw['voice_id']})
    yield {'type':'start','request_id':kw['request_id']}
    if getattr(owner,'disconnect',False):minimax_session.configure(owner.session,{'disconnect':True})
    if getattr(owner,'failure_case',False):raise RuntimeError('DO-NOT-EXPOSE-INTERNAL-CONTENT')
    yield {'type':'audio','request_id':kw['request_id'],'seq':0,'audio_base64':'AAA='}
    yield {'type':'end','request_id':kw['request_id']}
  sys.modules['backend.minimax_voice']=types.SimpleNamespace(MinimaxVoiceClient=Client,MinimaxVoiceError=RuntimeError)
  class Handler:
   def __init__(self):self.wfile=io.BytesIO();self.response=None
   def payload(self,limit):return {'request_id':'test-request','speak':'你好'}
   def reply(self,data,code=200):self.response=(code,data)
   def send_response(self,code):self.response=(code,None)
   def send_header(self,*args):pass
   def end_headers(self):pass
   def session(self):return owner.session
  self.handler=Handler()
 def tearDown(self):
  if self.old is None:self.sys.modules.pop('backend.minimax_voice',None)
  else:self.sys.modules['backend.minimax_voice']=self.old
 def run_stream(self):minimax_session.stream(self.handler,self.session,threading.Lock())
 def test_success_estimates_once_and_rejects_replay(self):
  self.run_stream();self.assertTrue(self.session['minimax_verified']);self.assertEqual(self.session['minimax_characters'],4)
  self.run_stream();self.assertEqual(self.handler.response[0],409);self.assertEqual(len(self.calls),1)
 def test_budget_limit_prevents_provider_call(self):
  self.session['minimax_characters']=1999;self.run_stream();self.assertEqual(self.handler.response[0],429);self.assertEqual(self.calls,[])
 def test_disconnect_discards_late_audio(self):
  self.disconnect=True;self.run_stream();self.assertNotIn(b'audio_base64',self.handler.wfile.getvalue());self.assertFalse(self.session['minimax_verified'])
 def test_error_is_sanitized_and_slot_released(self):
  self.failure_case=True;self.run_stream();self.assertNotIn(b'DO-NOT-EXPOSE',self.handler.wfile.getvalue());self.assertIn(b'voice_unavailable',self.handler.wfile.getvalue());self.assertFalse(self.session['minimax_busy'])
 def test_no_key_never_calls_provider(self):
  minimax_session.configure(self.session,{'disconnect':True});self.run_stream();self.assertEqual(self.handler.response[0],412);self.assertEqual(self.calls,[])

class VoiceChoiceTests(unittest.TestCase):
 def test_choice_requires_connected_session_and_allowlist(self):
  with self.assertRaises(ValueError):minimax_session.configure({}, {'voice_id':minimax_session.VOICE})
  s={};minimax_session.configure(s,{'key':'test-voice-placeholder','consent':True});g=s['minimax_generation']
  chosen='Chinese (Mandarin)_Warm_Girl';r=minimax_session.configure(s,{'voice_id':chosen})
  self.assertEqual(r['voice'],chosen);self.assertNotEqual(g,r['generation']);self.assertNotIn('minimax_key',r)
  with self.assertRaises(ValueError):minimax_session.configure(s,{'voice_id':'arbitrary-clone'})
  self.assertEqual(s['minimax_voice'],chosen)
