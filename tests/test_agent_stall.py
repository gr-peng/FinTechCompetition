import unittest,threading,time,tempfile,types,json
from pathlib import Path
from unittest.mock import patch
import agent_runtime,agent_provider
from agent_errors import ProviderError
PAYLOAD={'validation_scope':'finpilot-fifteen-v1','text':'本月餐饮支出','tool_catalog':['dining_month'],'run_history':[]}
class StallTests(unittest.TestCase):
 def test_total_deadline_closes_a_body_read_and_never_marks_complete(self):
  released=threading.Event()
  class Connection:
   def request(self,*a):pass
   def getresponse(self):return self
   status=200
   def read(self,n):released.wait(1);raise OSError('simulated blocked body')
   def close(self):released.set()
  before=time.monotonic()
  with self.assertRaises(ProviderError) as raised:agent_provider.run_provider(PAYLOAD,'test-not-a-real-key','deepseek-flash','test',lambda *a,**kw:Connection(),deadline_seconds=.025)
  self.assertEqual(raised.exception.code,'timeout');self.assertEqual(raised.exception.diagnostic['protocol_stage'],'response_body');self.assertFalse(raised.exception.diagnostic['completed']);self.assertLess(time.monotonic()-before,.5)
 def test_independent_sessions_do_not_wait_behind_other_sessions_upstream_io(self):
  with tempfile.TemporaryDirectory() as tmp:
   release=threading.Event();both=threading.Event();entered=[];answers=[]
   def provider(*a,**kw):
    entered.append(1)
    if len(entered)==2:both.set()
    release.wait(2);return {'status':'answer'},{'completed':True}
   host={'AGENT_VALIDATION':True,'ALLOW_API':True,'agent_contract':types.SimpleNamespace(request_messages=lambda d:None,ContractError=ValueError),'agent_provider':types.SimpleNamespace(run_provider=provider,ProviderError=ProviderError),'LOCK':threading.Lock(),'AGENT_CODE_LOCK':threading.Lock(),'BUDGET':{'requests':0},'BUDGET_FILE':Path(tmp)/'budget.json','MODEL':'deepseek-flash','UPSTREAM_UA':'test','http':types.SimpleNamespace(client=types.SimpleNamespace(HTTPSConnection=None))}
   class Handler:
    def payload(self,n):return PAYLOAD
    def reply(self,data,status=200):answers.append(status)
   sessions=[{'key':'test-placeholder-one'},{'key':'test-placeholder-two'}]
   with patch.object(agent_runtime.importlib,'reload',side_effect=lambda value:value):
    threads=[threading.Thread(target=agent_runtime.request,args=(Handler(),s,host)) for s in sessions]
    for thread in threads:thread.start()
    ready=both.wait(1);release.set()
    for thread in threads:thread.join(3)
   self.assertTrue(ready);self.assertEqual(answers,[200,200]);self.assertTrue(all(s['agent_busy'] is False for s in sessions))
