import json
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import agent_provider
import agent_runtime
from agent_errors import ProviderError

PAYLOAD={'validation_scope':'finpilot-fifteen-v1','text':'hi','tool_catalog':[], 'run_history':[]}

class RetryAfterTests(unittest.TestCase):
    def test_standard_seconds_and_http_date(self):
        self.assertEqual(agent_provider.retry_after_seconds(' 120 '),120)
        self.assertEqual(agent_provider.retry_after_seconds('Thu, 01 Jan 1970 00:02:00 GMT',now=0),120)
        self.assertEqual(agent_provider.retry_after_seconds('Thu, 01 Jan 1970 00:00:00 GMT',now=10),0)
        for value in [None,Mock(),'-1','1.5','invalid private text','9'*129]:
            self.assertIsNone(agent_provider.retry_after_seconds(value))

    def test_429_and_503_keep_http_status_and_one_attempt_without_body_echo(self):
        for status,code in [(429,'rate_limited'),(503,'provider_error')]:
            conn=Mock();response=Mock(status=status)
            response.read.return_value=b'private provider text'
            response.getheader.return_value='180'
            conn.getresponse.return_value=response
            with self.assertRaises(ProviderError) as caught:
                agent_provider.run_provider(PAYLOAD,'test-only','deepseek-flash','test',lambda *a,**k:conn)
            error=caught.exception
            self.assertEqual(error.status,status);self.assertEqual(error.code,code)
            self.assertEqual(error.retry_after_seconds,180)
            self.assertEqual(error.diagnostic['upstream_retry_after_seconds'],180)
            self.assertFalse(error.diagnostic['completed'])
            self.assertNotIn('private',str(error));conn.request.assert_called_once()

    def test_runtime_honors_longer_provider_delay_and_blocks_manual_repeat_locally(self):
        with tempfile.TemporaryDirectory() as temp:
            failure=ProviderError('rate_limited','Rate limited',429)
            failure.retry_after_seconds=180
            failure.diagnostic={'error':'rate_limited','upstream_status':429,'upstream_retry_after_seconds':180,'completed':False}
            provider=Mock(side_effect=failure);answers=[]
            host={'AGENT_VALIDATION':True,'ALLOW_API':True,'agent_contract':types.SimpleNamespace(request_messages=lambda d:None,ContractError=ValueError),'agent_provider':types.SimpleNamespace(run_provider=provider,ProviderError=ProviderError),'LOCK':threading.Lock(),'AGENT_CODE_LOCK':threading.Lock(),'BUDGET':{'requests':0},'BUDGET_FILE':Path(temp)/'budget.json','MODEL':'deepseek-flash','UPSTREAM_UA':'test','http':types.SimpleNamespace(client=types.SimpleNamespace(HTTPSConnection=None))}
            class Handler:
                def payload(self,n):return PAYLOAD
                def reply(self,data,status=200):answers.append((data,status))
            session={'key':'test-only'}
            with patch.object(agent_runtime.importlib,'reload',side_effect=lambda value:value),patch.object(agent_runtime.time,'monotonic',return_value=100):
                agent_runtime.request(Handler(),session,host)
                agent_runtime.request(Handler(),session,host)
            self.assertEqual(session['agent_retry_after'],280)
            self.assertEqual(provider.call_count,1);self.assertEqual(host['BUDGET']['requests'],1)
            self.assertEqual(answers[0][0]['retry_after_seconds'],180)
            self.assertEqual(answers[1][0]['code'],'retry_later');self.assertEqual(answers[1][1],429)
            self.assertFalse(session['agent_busy'])
            saved=json.loads((Path(temp)/'agent-usage.jsonl').read_text().strip())
            self.assertEqual(saved['upstream_retry_after_seconds'],180)
            self.assertNotIn('key',saved)
