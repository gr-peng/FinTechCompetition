"""Provider isolation with synthetic RAM values; never sends supplier requests."""
import json
import unittest
from unittest.mock import Mock,patch
import chat_profile as p
import agent_provider

HOST={'ALLOW_API':True,'AGENT_VALIDATION':True}
class ProviderSwitchTests(unittest.TestCase):
    def test_micu_default_does_not_overwrite_session_choice_or_official_model(self):
        self.assertEqual(p.selected({'active_chat_provider':'micu'})['model'],'deepseek-flash')
        self.assertEqual(p.selected({'active_chat_provider':'micu','chat_models':{'micu':'my-chosen-model'}})['model'],'my-chosen-model')
        self.assertEqual(p.selected({})['model'],'MiniMax-M3.1-Flash')
    def session(self):
        return {'key':'synthetic-official-key','chat_provider':p.PROVIDER,'minimax_key':'synthetic-voice-key'}
    def save_micu(self,s):
        p.update_connection(s,{'provider':'micu','base_url':p.MICU_BASE,'model':p.MICU_MODEL,'key':'synthetic-micu-key'},HOST)
    def test_switch_does_not_copy_existing_official_or_voice_credential(self):
        s=self.session();p.update_connection(s,{'provider':'micu','mode':'select'},HOST)
        self.assertFalse(p.configured(s));self.assertIsNone(p.credential(s,'micu'))
        self.assertEqual(s['key'],'synthetic-official-key');self.assertEqual(s['minimax_key'],'synthetic-voice-key')
        p.update_connection(s,{'provider':p.PROVIDER,'mode':'select'},HOST)
        self.assertTrue(p.configured(s));self.assertEqual(p.credential(s,p.PROVIDER),'synthetic-official-key')
    def test_two_separate_credentials_and_disconnect_only_current_provider(self):
        s=self.session();self.save_micu(s)
        self.assertEqual(p.credential(s,'micu'),'synthetic-micu-key');self.assertEqual(p.credential(s,p.PROVIDER),'synthetic-official-key')
        p.clear_connection(s);self.assertFalse(p.configured(s));self.assertEqual(s['key'],'synthetic-official-key')
        self.save_micu(s);p.update_connection(s,{'provider':p.PROVIDER,'mode':'select'},HOST);p.clear_connection(s)
        self.assertFalse(p.configured(s));self.assertEqual(p.credential(s,'micu'),'synthetic-micu-key');self.assertEqual(s['minimax_key'],'synthetic-voice-key')
    def test_unbound_legacy_key_and_voice_key_cannot_configure_either_provider(self):
        for s in ({'key':'synthetic-old-key'},{'key':'synthetic-old-key','chat_provider':'micu'},{'minimax_key':'synthetic-voice-key'}):
            for provider in (p.PROVIDER,'micu'):
                s['active_chat_provider']=provider;self.assertFalse(p.configured(s))
    def test_bad_provider_model_or_destination_is_rejected_without_mutation(self):
        for data in ({'provider':'evil','mode':'select'},{'provider':'micu','base_url':p.BASE,'key':'synthetic-key'},{'provider':p.PROVIDER,'base_url':p.BASE,'model':'   ','key':'synthetic-key'}):
            s=self.session();before=dict(s)
            with self.assertRaises(p.ConfigError):p.update_connection(s,data,HOST)
            self.assertEqual(s,before)
    def test_inflight_request_blocks_switch_save_and_disconnect(self):
        s=self.session();s['agent_busy']=True
        for run in (lambda:p.update_connection(s,{'provider':'micu','mode':'select'},HOST),lambda:self.save_micu(s),lambda:p.clear_connection(s)):
            with self.assertRaises(p.ConfigError) as caught:run()
            self.assertEqual(caught.exception.status,409)
        self.assertTrue(p.configured(s))
    def test_status_reports_fixed_profile_and_only_configured_flags(self):
        s=self.session();self.save_micu(s);result=p.status(s,HOST)
        self.assertEqual(result['provider'],'micu');self.assertEqual(result['model'],p.MICU_MODEL);self.assertEqual(result['base_url'],p.MICU_BASE)
        self.assertEqual([x['configured'] for x in result['providers']],[True,True]);self.assertNotIn('synthetic',json.dumps(result))
    def test_provider_switch_does_not_bypass_cooldown_or_apply_it_to_other_provider(self):
        s=self.session();s['agent_retry_after']=1000;s['agent_transient_failures']=2
        p.update_connection(s,{'provider':'micu','mode':'select'},HOST)
        self.assertNotIn('agent_retry_after',s)
        s['agent_retry_after']=2000
        p.update_connection(s,{'provider':p.PROVIDER,'mode':'select'},HOST)
        self.assertEqual(s['agent_retry_after'],1000);self.assertEqual(s['agent_transient_failures'],2)
        p.update_connection(s,{'provider':p.PROVIDER,'mode':'select'},HOST)
        self.assertEqual(s['agent_retry_after'],1000)
    def test_explicit_micu_binding_calls_only_the_known_micu_host(self):
        plan={'status':'answer','scenario':'other','reply':'你好','query':None,'fields':{},'missing':[],'mode':'none','task_id':None}
        response=Mock(status=200);response.read.return_value=json.dumps({'model':p.MICU_MODEL,'choices':[{'finish_reason':'stop','message':{'content':json.dumps(plan)}}]}).encode()
        conn=Mock();conn.getresponse.return_value=response;factory=Mock(return_value=conn)
        with patch.object(p,'live_official_only',True):
            agent_provider.run_provider({'text':'你好','tool_catalog':[],'run_history':[]},'synthetic-micu-key',p.MICU_MODEL,'test',factory,provider_binding='micu')
        factory.assert_called_once_with('www.micuapi.ai',timeout=30)
        self.assertEqual(conn.request.call_args.args[3]['Authorization'],'Bearer synthetic-micu-key')
    def test_unknown_binding_rejected_before_connection(self):
        factory=Mock()
        with self.assertRaises(agent_provider.ProviderError):agent_provider.run_provider({},'synthetic-key','custom-model','test',factory,provider_binding='unknown')
        factory.assert_not_called()

    def test_models_are_saved_separately_without_copying_credentials(self):
        s=self.session();self.save_micu(s)
        before_keys=(s['key'],s['chat_connections']['micu']['key'],s['minimax_key'])
        for provider,base,model in ((p.PROVIDER,p.BASE,' MiniMax-M3 '),('micu',p.MICU_BASE,' vendor/custom:fast ')):
            p.update_connection(s,{'provider':provider,'base_url':base,'model':model,'key':''},HOST)
        self.assertEqual(s['chat_models'],{p.PROVIDER:'MiniMax-M3','micu':'vendor/custom:fast'})
        p.select_connection(s,p.PROVIDER);self.assertEqual(p.selected(s)['model'],'MiniMax-M3')
        p.select_connection(s,'micu');self.assertEqual(p.selected(s)['model'],'vendor/custom:fast')
        self.assertEqual((s['key'],s['chat_connections']['micu']['key'],s['minimax_key']),before_keys)
        self.assertNotIn('synthetic',json.dumps(p.status(s,HOST)))

    def test_custom_model_does_not_select_the_credential_destination(self):
        plan={'status':'answer','scenario':'other','reply':'你好','query':None,'fields':{},'missing':[],'mode':'none','task_id':None}
        for binding,model,host in ((p.PROVIDER,'MiniMax-M3','api.minimax.cn'),('micu',p.MODEL,'www.micuapi.ai'),('micu','vendor/custom:fast','www.micuapi.ai')):
            response=Mock(status=200);response.read.return_value=json.dumps({'model':model,'choices':[{'finish_reason':'stop','message':{'content':json.dumps(plan)}}]}).encode()
            conn=Mock();conn.getresponse.return_value=response;factory=Mock(return_value=conn)
            agent_provider.run_provider({'text':'你好','tool_catalog':[],'run_history':[]},'synthetic-key',model,'test',factory,provider_binding=binding)
            factory.assert_called_once_with(host,timeout=30)
            body=json.loads(conn.request.call_args.args[2]);self.assertEqual(body['model'],model)
            if model!=p.MICU_MODEL:self.assertNotIn('thinking',body)

    def test_empty_model_or_unconnected_blank_key_does_not_mutate_session(self):
        import copy
        for provider,model in ((p.PROVIDER,' '),('micu','custom')):
            s=self.session();before=copy.deepcopy(s)
            with self.assertRaises(p.ConfigError):p.update_connection(s,{'provider':provider,'base_url':p.PROFILES[provider]['base_url'],'model':model,'key':''},HOST)
            self.assertEqual(s,before)
