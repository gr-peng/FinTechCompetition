"""Official protocol and credential-boundary checks. No supplier requests."""
import json
import unittest
import types
from pathlib import Path
from unittest.mock import Mock, patch
from backend import agent_provider
from backend import agent_runtime
from backend import chat_profile

PAYLOAD={'validation_scope':'finpilot-fifteen-v1','text':'你好','tool_catalog':[],'run_history':[]}
PLAN={'status':'answer','scenario':'other','reply':'你好。','query':None,'fields':{},'missing':[],'mode':'none','task_id':None}


class OfficialChatTests(unittest.TestCase):
    def invoke(self, content=None, reason='stop', status=200):
        response=Mock(status=status)
        response.read.return_value=json.dumps({'model':chat_profile.MODEL,'choices':[{
            'finish_reason':reason,'message':{'content':json.dumps(PLAN) if content is None else content,
                                           'reasoning_content':'PRIVATE_REASONING_NOT_FOR_UI'}}]}).encode()
        response.getheader.return_value='45'
        conn=Mock();conn.getresponse.return_value=response
        factory=Mock(return_value=conn)
        return conn,factory

    def test_official_destination_low_effort_and_final_content_only(self):
        conn,factory=self.invoke()
        result,meta=agent_provider.run_provider(PAYLOAD,'synthetic-chat-key',chat_profile.MODEL,'unit-test',factory,provider_binding=chat_profile.PROVIDER)
        factory.assert_called_once_with('api.minimax.cn',timeout=30)
        self.assertEqual(conn.request.call_args.args[:2],('POST','/v1/chat/completions'))
        body=json.loads(conn.request.call_args.args[2])
        self.assertEqual(body['model'],chat_profile.MODEL)
        self.assertEqual(body['reasoning_effort'],'low')
        self.assertEqual(body['max_completion_tokens'],4096)
        self.assertTrue(body['reasoning_split'])
        self.assertEqual(body['messages'][-1]['role'],'system')
        self.assertIn('绝不直接返回纯文本',body['messages'][-1]['content'])
        for forbidden in ('thinking','temperature','service_tier','response_format'):
            self.assertNotIn(forbidden,body)
        self.assertEqual(result['reply'],'你好。')
        self.assertEqual(meta['returned_model'],chat_profile.MODEL)
        self.assertNotIn('PRIVATE_REASONING',json.dumps([result,meta]))
        self.assertNotIn('synthetic-chat-key',json.dumps([result,meta]))
        self.assertEqual(conn.request.call_count,1)

    def test_truncation_and_malformed_json_never_execute_or_retry(self):
        for content,reason in [('', 'length'),('not-json','stop')]:
            conn,factory=self.invoke(content,reason)
            with self.assertRaises(agent_provider.ProviderError):
                agent_provider.run_provider(PAYLOAD,'synthetic-chat-key',chat_profile.MODEL,'test',factory,provider_binding=chat_profile.PROVIDER)
            self.assertEqual(conn.request.call_count,1)

    def test_official_rate_limit_respects_retry_after(self):
        conn,factory=self.invoke(status=429)
        with self.assertRaises(agent_provider.ProviderError) as caught:
            agent_provider.run_provider(PAYLOAD,'synthetic-chat-key',chat_profile.MODEL,'test',factory,provider_binding=chat_profile.PROVIDER)
        self.assertEqual(caught.exception.status,429)
        self.assertEqual(caught.exception.retry_after_seconds,45)
        self.assertEqual(conn.request.call_count,1)

    def test_legacy_or_voice_credentials_are_not_official_chat_authorization(self):
        for session in ({'key':'synthetic-micu-key'}, {'voice_key':'synthetic-voice-key'},
                        {'key':'synthetic-micu-key','chat_provider':'micu'}):
            handler=Mock()
            agent_runtime.request(handler,session,{'MODEL':chat_profile.MODEL})
            handler.reply.assert_called_once()
            self.assertEqual(handler.reply.call_args.args[1],412)
            handler.payload.assert_not_called()
            self.assertFalse(chat_profile.configured(session))

    def test_invalid_model_rejected_before_any_connection(self):
        factory=Mock()
        with self.assertRaises(agent_provider.ProviderError):
            agent_provider.run_provider(PAYLOAD,'synthetic-chat-key','invalid model\n','test',factory,provider_binding=chat_profile.PROVIDER)
        factory.assert_not_called()

    def test_running_app_never_contacts_micu_even_if_profile_refresh_is_unavailable(self):
        fake=types.SimpleNamespace(__file__=str(Path(__file__).parents[1]/'server.py'),
                                   Handler=types.SimpleNamespace(server_version='FinPilotLocal'))
        factory=Mock()
        with patch.dict(agent_provider.sys.modules,{'__main__':fake}), patch.object(chat_profile,'live_official_only',False):
            with self.assertRaises(agent_provider.ProviderError):
                agent_provider.run_provider(PAYLOAD,'synthetic-legacy-key','deepseek-v4-flash-0731','test',factory)
        factory.assert_not_called()
