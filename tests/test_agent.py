import json
import unittest
from unittest.mock import Mock
from agent_contract import validate_result, request_messages, ContractError, QUERIES
from agent_provider import run_provider, ProviderError

KEY='unit-test-fake-only-credential'
PLAN={'status':'answer','scenario':'question','reply':'本月餐饮见下方数据卡。','query':'dining_month','fields':{},'missing':[],'mode':'none','task_id':None}
PAYLOAD={'validation_scope':'finpilot-fifteen-v1','text':'这个月吃饭花多少','tool_catalog':['dining_month'],'run_history':[],'run_draft':None,'run_active_task':None,'clarification':None}

class Response:
    def __init__(self,body,status=200):self.body=body;self.status=status
    def read(self,n):return self.body[:n]

class AgentTests(unittest.TestCase):
    def provider(self,envelope,status=200):
        conn=Mock();conn.getresponse.return_value=Response(json.dumps(envelope).encode(),status)
        return conn,lambda *args,**kwargs:conn

    def test_structured_call_is_real_provider_path_with_only_current_run_context(self):
        envelope={'model':'deepseek-flash','usage':{'prompt_tokens':100,'completion_tokens':40,'total_tokens':140},'choices':[{'message':{'content':json.dumps(PLAN,ensure_ascii=False)},'finish_reason':'stop'}]}
        conn,factory=self.provider(envelope)
        result,meta=run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)
        self.assertEqual(result['query'],'dining_month');self.assertTrue(meta['completed']);self.assertEqual(meta['usage']['total_tokens'],140)
        args=conn.request.call_args.args;self.assertEqual(args[:2],('POST','/v1/chat/completions'))
        body=json.loads(args[2]);self.assertFalse(body['stream']);self.assertNotIn('preferences',body['messages'][-1]['content']);self.assertIsNone(meta['cost'])
        self.assertEqual(body['response_format'],{'type':'json_object'})
        conn.close.assert_called_once()

    def test_old_conversations_preferences_and_ledger_context_are_rejected_before_network(self):
        for field in ('history','preferences','tool_results','context'):
            with self.assertRaises(ContractError):request_messages({**PAYLOAD,field:'not-authorized-old-data'})

    def test_recent_new_run_history_and_clarification_are_kept(self):
        p={**PAYLOAD,'run_history':[{'role':'user','text':'帮我安排点钱'},{'role':'assistant','text':'你想怎么安排？'}],'run_draft':{'fields':{},'choice_order':['family','travel','cash']},'clarification':{'purpose':'travel','amount_minor':120000}}
        messages=request_messages(p);self.assertEqual(len(messages),4);self.assertEqual(messages[1]['content'],'帮我安排点钱');self.assertIn('120000',messages[-1]['content'])

    def test_invalid_fields_unknown_tool_or_negative_amount_are_not_actions(self):
        for value in [{**PLAN,'query':'send_money'},{**PLAN,'fields':{'amount_minor':-1}},{**PLAN,'execute_now':True}]:
            with self.assertRaises(ContractError):validate_result(value)

    def test_provider_401_and_timeout_are_explicit_without_fallback(self):
        conn,factory=self.provider({'error':{'message':KEY}},401)
        with self.assertRaises(ProviderError) as raised:run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)
        self.assertEqual(raised.exception.code,'invalid_key');self.assertNotIn(KEY,str(raised.exception))
        conn.request.side_effect=TimeoutError()
        with self.assertRaises(ProviderError) as raised:run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)
        self.assertEqual(raised.exception.status,504)

    def test_length_and_bad_json_never_become_success(self):
        for content,reason in [('bad-json','stop'),(json.dumps(PLAN),'length')]:
            conn,factory=self.provider({'choices':[{'message':{'content':content},'finish_reason':reason}]})
            with self.assertRaises(ProviderError):run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)

    def test_existing_card_entry_has_valid_clarification_and_schema_errors_are_safe(self):
        plan={**PLAN,'status':'clarify','scenario':'card_review','query':None,'missing':['transaction_ref']}
        self.assertEqual(validate_result(plan)['missing'],['transaction_ref'])
        invalid={**plan,'scenario':'card','reply':KEY}
        conn,factory=self.provider({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(invalid)}}]})
        with self.assertRaises(ProviderError) as raised:run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)
        meta=raised.exception.diagnostic
        self.assertEqual(meta['protocol_stage'],'contract');self.assertEqual(meta['schema_error'],'invalid planner shape')
        self.assertNotIn(KEY,json.dumps(meta));self.assertFalse(meta['completed'])

    def test_greeting_is_real_model_conversation_even_with_pending_draft(self):
        greeting={**PLAN,'scenario':'other','reply':'你好，有什么我可以帮你？','query':None}
        conn,factory=self.provider({'choices':[{'finish_reason':'stop','message':{'content':json.dumps(greeting)}}]})
        result,meta=run_provider({**PAYLOAD,'text':'hi','run_draft':{'id':'test-draft','fields':{},'missing':['purpose','amount_minor']}},KEY,'deepseek-flash','unit-test',factory)
        self.assertEqual(result['scenario'],'other');self.assertIsNone(result['query']);self.assertTrue(meta['completed'])
        self.assertEqual(conn.request.call_count,1)
        with self.assertRaises(ContractError):validate_result({**greeting,'status':'clarify'})

    def test_completed_explanation_selects_local_receipt_tool_without_sending_receipts(self):
        plan={**PLAN,'query':'recent_task','fields':{'purpose':'travel'},'reply':'请看已完成的安排。'}
        self.assertEqual(validate_result(plan)['query'],'recent_task')
        messages=request_messages({**PAYLOAD,'text':'解释刚才安排，不要执行','tool_catalog':list(QUERIES)})
        self.assertIn('recent_task',messages[-1]['content']);self.assertNotIn('FP-',messages[-1]['content'])
        self.assertTrue(request_messages(PAYLOAD))

if __name__=='__main__':unittest.main()
