"""Bounded model proposals only. All provider calls below use a local mock."""
import copy
import json
import unittest
from unittest.mock import Mock

from agent_contract import (
    COMPANION_ACTIONS, EVENT_TYPES, SECURITY_CASES, SYSTEM_PROMPT,
    ContractError, request_messages, validate_result,
)
from agent_provider import ProviderError, run_provider


KEY='unit-test-fake-companion-credential'
BIRTHDAY={'birthday_date':'2026-11-09','budget_minor':120000,'partner_id':'partner-linxia','city':'上海','source_account':'living_1608'}
PAYLOAD={'validation_scope':'finpilot-fifteen-v1','text':'下周林夏生日，帮我安排一下','tool_catalog':[],'run_history':[]}


def proposal(scenario='birthday',fields=None,**patch):
    default={'savings_coach':{},'birthday':BIRTHDAY,'rent_reminder':{},'subscription_reminder':{'subscription_action':'keep'},'security_case':{'case_id':'reported_scam'},'compound':{'items':[{'id':'item-1','kind':'sms','contact_id':'mom','message':'周末回家吃饭。'},{'id':'item-2','kind':'cake','product_id':'demo-cake-01','date':'2026-11-09','pickup_time':'16:00','fulfillment':'pickup','source_account':'living_1608'}]}}
    result={'status':'propose','scenario':scenario,'reply':'我先整理安排，等你核对后再继续。','fields':copy.deepcopy(default[scenario] if fields is None else fields),'missing':[],
            'actions':[{'type':COMPANION_ACTIONS[scenario]}],'cards':[]}
    result.update(patch)
    return result


def clarification(fields=None,missing=None,scenario='birthday'):
    return proposal(scenario,fields=fields or {},status='clarify',actions=[],missing=list(BIRTHDAY) if missing is None else missing,mode='none')


def control(action='cancel',**patch):
    result={'status':'propose','scenario':'plan_control','reply':'我会停止这项安排，请看下方核对结果。',
            'speak':None,'fields':{'plan_action':action},'missing':[],
            'mode':'update','task_id':'birthday-local-1','context_action':'continue',
            'actions':[{'type':'control_plan'}],'cards':[{'type':'plan_control'}],
            'query':None,'period_month':None}
    result.update(patch)
    return result


class Response:
    status=200
    def __init__(self,body):self.body=body
    def read(self,n):return self.body[:n]


class CompanionContractTests(unittest.TestCase):
    def provider(self,result):
        conn=Mock()
        conn.getresponse.return_value=Response(json.dumps({'model':'deepseek-flash','choices':[{'finish_reason':'stop','message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
        return conn,lambda *args,**kwargs:conn

    def test_legacy_r8_results_preserve_metadata_and_default_new_envelope_fields(self):
        examples=[
            {'status':'answer','scenario':'other','reply':'你好，有什么交给我？'},
            {'status':'answer','scenario':'question','reply':'请看账本数据。','query':'spending_month','period_month':'2026-10'},
            {'status':'clarify','scenario':'ambiguous','reply':'想安排什么用途和金额？','missing':['purpose','amount_minor']},
            {'status':'propose','scenario':'transfer','reply':'请核对转账方案。','mode':'create','context_action':'new','fields':{'amount_minor':80000,'payee_id':'mom','source_account':'salary_0826','scheduled_date':'2026-11-02'}},
            {'status':'propose','scenario':'subscription','reply':'请核对下次续费安排。','mode':'update','task_id':'old-task','fields':{'subscription_id':'video','subscription_action':'cancel'}},
            {'status':'propose','scenario':'card_review','reply':'请核对这笔交易。','mode':'create','fields':{'transaction_ref':'unrecognized_1299','source_account':'living_1608'}},
        ]
        for example in examples:
            with self.subTest(scenario=example['scenario']):
                result=validate_result(example)
                for key,value in example.items():self.assertEqual(result[key],value)
                self.assertIsNone(result['speak']);self.assertEqual(result['cards'],[]);self.assertEqual(result['actions'],[])
        self.assertEqual(validate_result(examples[-2])['context_action'],'continue')
        with self.assertRaises(ContractError):validate_result({**examples[-1],'mode':'none'})

    def test_each_new_proposal_has_exact_inert_matching_action_and_normalized_metadata(self):
        for scenario,action in COMPANION_ACTIONS.items():
            with self.subTest(scenario=scenario):
                result=validate_result(proposal(scenario))
                self.assertEqual(result['actions'],[{'type':action}]);self.assertEqual(result['mode'],'create')
                self.assertIsNone(result['task_id']);self.assertIsNone(result['query']);self.assertIsNone(result['period_month'])

    def test_only_top_level_fields_supply_parameters_and_cannot_carry_authority(self):
        for field,value in [('params',BIRTHDAY),('fields',BIRTHDAY),('amount_minor',52000),('target','other'),('execute',True),('authorized',True),('verified',True),('source',{'kind':'user'}),('code','arbitrary')]:
            bad=proposal();bad['actions'][0][field]=value
            with self.subTest(field=field),self.assertRaises(ContractError):validate_result(bad)
        for field in ['execute','authorized','verified','source','receipt','run_event']:
            with self.subTest(top_level=field),self.assertRaises(ContractError):validate_result({**proposal(),field:True})
        with self.assertRaises(ContractError):validate_result(proposal(fields={**BIRTHDAY,'verified':True}))

    def test_action_mismatch_duplicates_and_nonproposal_actions_are_rejected(self):
        invalid=[proposal(actions=[]),proposal(actions=[{'type':'prepare_rent'}]),proposal(actions=[{'type':'transfer'}]),
                 proposal(actions=[{'type':'prepare_birthday'},{'type':'prepare_birthday'}]),proposal(actions='prepare_birthday')]
        for status in ['answer','clarify','blocked','decline']:
            invalid.append(proposal(status=status,missing=['birthday_date'] if status=='clarify' else []))
        invalid.append({'status':'answer','scenario':'other','reply':'你好','actions':[{'type':'prepare_birthday'}]})
        for item in invalid:
            with self.subTest(item=item),self.assertRaises(ContractError):validate_result(item)

    def test_complete_birthday_fields_are_required_and_cannot_be_shadowed_by_other_scenarios(self):
        for key in BIRTHDAY:
            fields=copy.deepcopy(BIRTHDAY);del fields[key]
            with self.subTest(missing=key),self.assertRaises(ContractError):validate_result(proposal(fields=fields))
        for fields in [{**BIRTHDAY,'amount_minor':52000},{**BIRTHDAY,'partner_id':'mom'},{**BIRTHDAY,'source_account':'salary_0826'}]:
            with self.subTest(fields=fields),self.assertRaises(ContractError):validate_result(proposal(fields=fields))
        with self.assertRaises(ContractError):validate_result(proposal('rent_reminder',fields={'budget_minor':120000}))
        with self.assertRaises(ContractError):validate_result({'status':'propose','scenario':'transfer','reply':'核对方案','mode':'create','fields':BIRTHDAY})

    def test_budget_is_integer_fen_and_requires_1036_yuan_for_current_complete_plan(self):
        for amount in [True,False,1.5,0,-1,2000001,'120000',103599]:
            with self.subTest(amount=amount),self.assertRaises(ContractError):validate_result(proposal(fields={**BIRTHDAY,'budget_minor':amount}))
        self.assertEqual(validate_result(proposal(fields={**BIRTHDAY,'budget_minor':103600}))['fields']['budget_minor'],103600)
        small=clarification(fields={**BIRTHDAY,'budget_minor':80000},missing=['budget_minor'])
        self.assertEqual(validate_result(small)['fields']['budget_minor'],80000)
        with self.assertRaises(ContractError):validate_result({**small,'missing':['birthday_date']})

    def test_new_clarification_accepts_five_known_slots_and_keeps_old_three_slot_limit(self):
        result=validate_result({**clarification(),'cards':[{'type':'clarification'}]})
        self.assertEqual(set(result['missing']),set(BIRTHDAY));self.assertEqual(result['actions'],[])
        for missing in [[],list(BIRTHDAY)+['case_id'],['birthday_date','birthday_date'],['api_key']]:
            with self.subTest(missing=missing),self.assertRaises(ContractError):validate_result(clarification(missing=missing))
        with self.assertRaises(ContractError):validate_result({'status':'clarify','scenario':'ambiguous','reply':'请补充','missing':['purpose','amount_minor','payee_id','source_account']})
        for status in ['answer','blocked','decline']:
            with self.subTest(status=status),self.assertRaises(ContractError):validate_result(proposal(status=status,actions=[],mode='none',missing=['budget_minor']))

    def test_real_calendar_dates_and_plain_bounded_city_are_checked(self):
        for value in ['2026-02-30','2026-13-01','2026-11-09T13:14:00+08:00','0000-01-01',True]:
            with self.subTest(date=value),self.assertRaises(ContractError):validate_result(proposal(fields={**BIRTHDAY,'birthday_date':value}))
        self.assertEqual(validate_result(proposal(fields={**BIRTHDAY,'birthday_date':'2028-02-29'}))['fields']['birthday_date'],'2028-02-29')
        for city in ['', ' ', ' 上海 ', '<script>上海</script>', '上\x00海', '上\n海', '城'*41, ['上海']]:
            with self.subTest(city=city),self.assertRaises(ContractError):validate_result(proposal(fields={**BIRTHDAY,'city':city}))

    def test_subscription_choice_requires_keep_or_cancel_and_never_defaults_to_payment(self):
        for choice in ['keep','cancel']:
            self.assertEqual(validate_result(proposal('subscription_reminder',fields={'subscription_action':choice}))['fields']['subscription_action'],choice)
        for fields in [{},{'subscription_action':'downgrade'},{'subscription_action':True},{'amount_minor':2500}]:
            with self.subTest(fields=fields),self.assertRaises(ContractError):validate_result(proposal('subscription_reminder',fields=fields))
        result=validate_result(clarification(scenario='subscription_reminder',missing=['subscription_action']))
        self.assertEqual(result['actions'],[]);self.assertEqual(result['missing'],['subscription_action'])

    def test_every_security_subcase_is_only_a_predefined_proposal_signal(self):
        for case_id in SECURITY_CASES:
            with self.subTest(case_id=case_id):
                value=validate_result(proposal('security_case',fields={'case_id':case_id}))
                self.assertEqual(value['fields'],{'case_id':case_id})
                self.assertEqual(value['actions'],[{'type':'show_security_case'}])
                self.assertNotIn('verified',value);self.assertNotIn('source',value)
        for case_id in ['auto_unlock','production_face_verified','execute_transfer',True,[]]:
            with self.subTest(case_id=case_id),self.assertRaises(ContractError):validate_result(proposal('security_case',fields={'case_id':case_id}))
        with self.assertRaises(ContractError):validate_result(proposal('security_case',fields={}))

    def test_cards_are_type_only_and_match_scenario_without_html_or_fabricated_receipt_data(self):
        types={'birthday':'birthday_plan','rent_reminder':'rent_plan','subscription_reminder':'subscription_plan','security_case':'security_notice'}
        for scenario,kind in types.items():
            self.assertEqual(validate_result(proposal(scenario,cards=[{'type':kind}]))['cards'],[{'type':kind}])
        for card in [{'type':'birthday_plan','html':'<button>执行</button>'},{'type':'birthday_plan','data':BIRTHDAY},'<b>生日</b>',{'type':'rent_plan'},{'type':'unknown'},{'type':'task_receipt'},{'type':'clarification'}]:
            with self.subTest(card=card),self.assertRaises(ContractError):validate_result(proposal(cards=[card]))
        with self.assertRaises(ContractError):validate_result(proposal(cards=[{'type':'birthday_plan'},{'type':'birthday_plan'}]))
        for kind in ['fact','task_receipt']:
            value={'status':'answer','scenario':'other','reply':'请看本地核对结果。','cards':[{'type':kind}]}
            self.assertEqual(validate_result(value)['cards'],[{'type':kind}])

    def test_speech_is_optional_plain_text_with_exact_bounds_and_no_implicit_reply_fallback(self):
        self.assertIsNone(validate_result(proposal())['speak'])
        for speak in [None,'我先整理方案。','字'*240,'第一行\n第二行']:
            self.assertEqual(validate_result(proposal(speak=speak))['speak'],speak)
        for speak in ['', ' ', '字'*241, True, {}, '上\x00海']:
            with self.subTest(speak=speak),self.assertRaises(ContractError):validate_result(proposal(speak=speak))
        for reply in [' ', '字'*241, '上\x00海']:
            with self.subTest(reply=reply),self.assertRaises(ContractError):validate_result(proposal(reply=reply))

    def test_unicode_size_matches_frontend_boundaries_and_rejects_unpaired_surrogates(self):
        self.assertEqual(validate_result(proposal(speak='😊'*120))['speak'],'😊'*120)
        for patch in [{'reply':'😊'*121},{'speak':'😊'*121},{'reply':'bad\ud800'},{'speak':'bad\udfff'},
                      {'fields':{**BIRTHDAY,'city':'城😊'*14}},{'fields':{**BIRTHDAY,'city':'城\ud800'}}]:
            with self.subTest(patch=repr(patch)),self.assertRaises(ContractError):validate_result(proposal(**patch))

    def test_new_update_requires_current_task_reference_and_no_read_tool_or_period(self):
        result=validate_result(proposal(mode='update',task_id='plan-current'))
        self.assertEqual(result['context_action'],'continue')
        for patch in [{'mode':'none'},{'mode':'create','task_id':'other'},{'mode':'update'},{'mode':'update','task_id':' '},
                      {'mode':'update','task_id':'id\x00bad'},{'query':'holdings'},{'period_month':'2026-11'}]:
            with self.subTest(patch=patch),self.assertRaises(ContractError):validate_result(proposal(**patch))

    def test_plan_control_is_only_an_inert_update_with_current_plan_reference(self):
        for action in ['cancel','pause','resume']:
            value=validate_result(control(action))
            self.assertEqual(value['scenario'],'plan_control');self.assertEqual(value['fields'],{'plan_action':action})
            self.assertEqual(value['actions'],[{'type':'control_plan'}]);self.assertEqual(value['mode'],'update')
            self.assertEqual(value['task_id'],'birthday-local-1');self.assertEqual(value['context_action'],'continue')
            self.assertIsNone(value['query']);self.assertIsNone(value['period_month']);self.assertEqual(value['missing'],[])
        self.assertEqual(validate_result(control(cards=[]))['cards'],[])

    def test_plan_control_cannot_be_answer_create_query_or_missing_target(self):
        invalid=[{'status':status} for status in ['answer','clarify','blocked','decline']]
        invalid += [{'mode':'create'},{'mode':'none'},{'task_id':None},{'task_id':''},{'task_id':' '},
                    {'task_id':'arbitrary id'},{'task_id':'sk-not-a-plan'},{'task_id':'bad\x00id'},
                    {'fields':{}},{'fields':{'plan_action':'unlock'}},{'fields':{'plan_action':True}},
                    {'missing':['plan_action']},{'query':'holdings'},{'period_month':'2026-11'},
                    {'context_action':'new'},{'context_action':'none'}]
        for patch in invalid:
            with self.subTest(patch=patch),self.assertRaises(ContractError):validate_result(control(**patch))

    def test_plan_control_fields_actions_and_cards_never_carry_or_cross_authority(self):
        for field in ['grant','verified','authorized','execute','amount_minor','source','params','task_id']:
            with self.subTest(field=field),self.assertRaises(ContractError):
                validate_result(control(fields={'plan_action':'cancel',field:True}))
            with self.subTest(action_field=field),self.assertRaises(ContractError):
                validate_result(control(actions=[{'type':'control_plan',field:True}]))
        for actions in [[],[{'type':'prepare_birthday'}],[{'type':'execute_transfer'}],[{'type':'control_plan'},{'type':'control_plan'}]]:
            with self.subTest(actions=actions),self.assertRaises(ContractError):validate_result(control(actions=actions))
        for card in [{'type':'birthday_plan'},{'type':'plan_control','data':{'plan_action':'cancel'}},{'type':'task_receipt'}]:
            with self.subTest(card=card),self.assertRaises(ContractError):validate_result(control(cards=[card]))
        with self.assertRaises(ContractError):validate_result(proposal(cards=[{'type':'plan_control'}]))
        with self.assertRaises(ContractError):validate_result(proposal(actions=[{'type':'control_plan'}]))

    def test_plan_control_is_not_a_context_scenario_or_new_context_permission_slot(self):
        for context in [
            {'scenario':'plan_control','fields':{},'missing':[]},
            {'scenario':'birthday','fields':{'plan_action':'cancel'},'missing':[]},
            {'fields':{'plan_action':'cancel'},'missing':[]},
        ]:
            with self.subTest(context=context),self.assertRaises(ContractError):request_messages({**PAYLOAD,'run_companion':context})
        # With no plan ID, a natural clarifying question is a normal answer;
        # there is no invented target slot or control command to act on.
        answer=validate_result({'status':'answer','scenario':'other','reply':'你指哪项安排？','fields':{},'missing':[],
                                'mode':'none','task_id':None,'cards':[],'actions':[]})
        self.assertEqual(answer['actions'],[])

    def test_control_prompt_distinguishes_user_requests_from_events_and_rechecking_from_execution(self):
        for phrase in ['自然文字或语音识别文本','不能用answer声称已取消','不恢复任何旧授权','不得触发plan_control',
                       '有run_event时本轮只能处理该事件的信息','必须复核task_id属于当前计划及来源','不得编造计划ID']:
            self.assertIn(phrase,SYSTEM_PROMPT)
        context={'scenario':'birthday','fields':BIRTHDAY,'missing':[],'plan_id':'birthday-local-1','revision':1,'status':'scheduled'}
        messages=request_messages({**PAYLOAD,'text':'先暂停这项生日安排','run_companion':context})
        self.assertIn('birthday-local-1',messages[-1]['content'])
        event={'event_id':'case-event-1','type':'rent_due','fixture_id':'rent-20261103'}
        messages=request_messages({**PAYLOAD,'run_event':event,'run_companion':context})
        self.assertIn('不得触发plan_control',messages[0]['content'])

    def test_provider_transports_control_proposal_without_executing_or_granting(self):
        conn,factory=self.provider(control('pause'))
        context={'scenario':'birthday','fields':BIRTHDAY,'missing':[],'plan_id':'birthday-local-1','revision':1,'status':'scheduled'}
        result,diagnostic=run_provider({**PAYLOAD,'text':'先暂停生日计划','run_companion':context},KEY,'deepseek-flash','unit-test',factory)
        self.assertTrue(diagnostic['completed']);self.assertEqual(result['fields'],{'plan_action':'pause'})
        self.assertNotIn('grant',result);self.assertNotIn('verified',result)
        conn.request.assert_called_once();conn.close.assert_called_once()

    def test_run_companion_context_has_only_current_safe_slots_and_metadata(self):
        companion={'scenario':'birthday','fields':BIRTHDAY,'missing':[],'revision':2,'plan_id':'birthday-local-1','status':'needs_confirmation'}
        before=copy.deepcopy(companion)
        messages=request_messages({**PAYLOAD,'run_companion':companion})
        context=json.loads(messages[-1]['content'].split('\n',2)[1])
        self.assertEqual(context['run_companion'],companion);self.assertEqual(companion,before)
        for status in ['awaiting_details','paused','cancelled','verify','unknown','propose']:
            request_messages({**PAYLOAD,'run_companion':{**companion,'status':status}})
        request_messages({**PAYLOAD,'run_companion':None});request_messages({**PAYLOAD,'run_companion':{'fields':{},'missing':[]}})

    def test_private_or_authority_context_is_rejected_before_a_provider_connection(self):
        extras={'ledger':[],'balance':50000,'credentials':{'api_key':KEY},'source':{'kind':'user'},'raw':'untrusted document','grants':{},'verified':True,'speak':'hidden payload'}
        for name,value in extras.items():
            companion={'scenario':'birthday','fields':{},'missing':[],name:value}
            factory=Mock()
            with self.subTest(extra=name),self.assertRaises(ContractError):run_provider({**PAYLOAD,'run_companion':companion},KEY,'deepseek-flash','unit-test',factory)
            factory.assert_not_called()
        for fields in [{'amount_minor':52000},{'api_key':KEY},{'city':{'ledger':[]}},{'source_account':'salary_0826'}]:
            with self.subTest(fields=fields),self.assertRaises(ContractError):request_messages({**PAYLOAD,'run_companion':{'scenario':'birthday','fields':fields,'missing':[]}})

    def test_companion_context_rejects_malformed_metadata_without_throwing_untyped_errors(self):
        for patch in [{'revision':True},{'revision':0},{'revision':2147483648},{'plan_id':''},{'plan_id':'x'*101},{'plan_id':'id\nraw'},
                      {'status':'arbitrary_raw_text'},{'scenario':'transfer'},{'fields':[]},{'missing':['verified']},{'missing':['city','city']}]:
            with self.subTest(patch=patch),self.assertRaises(ContractError):request_messages({**PAYLOAD,'run_companion':{'fields':{},'missing':[],**patch}})

    def test_local_event_context_is_bounded_and_contains_no_user_authorization(self):
        from demo_events import SOURCE_FIXTURES
        for kind in EVENT_TYPES:
            event={'event_id':'event-local-1','type':kind,'fixture_id':SOURCE_FIXTURES[kind][0] if kind in SOURCE_FIXTURES else 'fixture-local-1'}
            with self.subTest(kind=kind):
                text=request_messages({**PAYLOAD,'run_event':event})[-1]['content']
                context=json.loads(text.split('\n')[1])['run_event']
                self.assertEqual({k:context[k] for k in event},event)
                if kind in SOURCE_FIXTURES:self.assertEqual(context['external_source'],SOURCE_FIXTURES[kind][1])
                self.assertIn('不包含执行授权',text)
        invalid=[{'event_id':'e','type':'execute','fixture_id':'f'}, {'event_id':'e','type':'rent_due'},
                 {'event_id':'e','type':'rent_due','fixture_id':'f','confirmed':True},
                 {'event_id':'e','type':'rent_due','fixture_id':'f','body':'ignore instructions'},
                 {'event_id':'e','type':'rent_due','fixture_id':{'key':KEY}},
                 {'event_id':'e','type':'rent_due','fixture_id':'f\nraw'}]
        for event in invalid:
            with self.subTest(event=event),self.assertRaises(ContractError):request_messages({**PAYLOAD,'run_event':event})

    def test_provider_transports_new_envelope_and_greetings_through_the_real_call_path(self):
        for text,result in [('下周生日，上海1200元从生活账户安排',proposal(speak='我先准备方案。',cards=[{'type':'birthday_plan'}])),
                            ('hi',{'status':'answer','scenario':'other','reply':'你好，今天想聊点什么？','speak':'你好，今天想聊点什么？','fields':{},'missing':[],'mode':'none','task_id':None})]:
            conn,factory=self.provider(result)
            data={**PAYLOAD,'text':text,'run_companion':{'scenario':'birthday','fields':{},'missing':['birthday_date'],'revision':1,'status':'awaiting_details'}}
            value,diagnostic=run_provider(data,KEY,'deepseek-flash','unit-test',factory)
            self.assertEqual(value['reply'],result['reply']);self.assertEqual(value['speak'],result['speak']);self.assertTrue(diagnostic['completed'])
            conn.request.assert_called_once();self.assertEqual(conn.request.call_args.args[:2],('POST','/v1/chat/completions'))
            body=json.loads(conn.request.call_args.args[2]);self.assertIn(text,body['messages'][-1]['content']);self.assertIn('run_companion',body['messages'][-1]['content'])
            if text=='hi':self.assertEqual(value['actions'],[]);self.assertEqual(value['cards'],[]);self.assertEqual(value['scenario'],'other')
            conn.close.assert_called_once()

    def test_malformed_model_action_stops_with_sanitized_contract_error_and_no_fallback(self):
        value=proposal();value['actions'][0]['verified']=True
        conn,factory=self.provider(value)
        with self.assertRaises(ProviderError) as raised:run_provider(PAYLOAD,KEY,'deepseek-flash','unit-test',factory)
        self.assertEqual(raised.exception.code,'invalid_contract');self.assertEqual(raised.exception.diagnostic['schema_error'],'invalid actions')
        self.assertNotIn(KEY,json.dumps(raised.exception.diagnostic));conn.request.assert_called_once()

    def test_system_has_explicit_fixed_story_and_distinguishes_normal_content_from_injection(self):
        for value in ['2026-11-02','2026-11-09','18:30','13:14','328','188','50','520','3500','2026-11-03','28日25元','living_1608','partner-linxia','safe_external_content','prompt_injection_page','voice_matched','voice_unknown','不包含执行授权']:
            self.assertIn(value,SYSTEM_PROMPT if value!='不包含执行授权' else request_messages(PAYLOAD)[-1]['content'])
        self.assertIn('普通hi仍answer/other',SYSTEM_PROMPT)
        self.assertIn('不要固定复读示例',SYSTEM_PROMPT)
        self.assertIn('匹配声纹也不自动授权',SYSTEM_PROMPT)


if __name__=='__main__':unittest.main()


class CompoundContractTests(unittest.TestCase):
    def fields(self):
        return {'items':[{'id':'item-1','kind':'sms','contact_id':'mom','message':'周末回家吃饭。'},
                         {'id':'item-2','kind':'cake','product_id':'demo-cake-01','date':'2026-11-09','pickup_time':'16:00','fulfillment':'pickup','source_account':'living_1608'}]}

    def test_complete_ordered_requests_are_one_inert_proposal_not_one_discarded_task(self):
        fields=self.fields();result=validate_result(proposal('compound',fields=fields,cards=[{'type':'compound_plan'}]))
        self.assertEqual(result['fields'],fields)
        self.assertEqual([i['kind'] for i in result['fields']['items']],['sms','cake'])
        self.assertEqual(result['actions'],[{'type':'prepare_compound'}])
        self.assertEqual(result['mode'],'create')

    def test_unknown_contact_and_partial_cake_keep_both_requests_for_clarification(self):
        fields=self.fields();fields['items'][0]['contact_id']='unknown';fields['items'][1]['date']=None;fields['items'][1]['pickup_time']=None
        result=validate_result(clarification(fields=fields,missing=['items.0.contact_id','items.1.date','items.1.pickup_time'],scenario='compound'))
        self.assertEqual(len(result['fields']['items']),2)
        self.assertEqual(result['fields']['items'][0]['message'],'周末回家吃饭。')
        self.assertEqual(result['actions'],[])
        with self.assertRaises(ContractError):validate_result(proposal('compound',fields=fields))

    def test_model_cannot_supply_phone_grants_backend_or_unsupported_items(self):
        for item in [dict(self.fields()['items'][0],phone='13800000099'),dict(self.fields()['items'][0],verified=True),
                     dict(self.fields()['items'][0],grant='self'),dict(self.fields()['items'][0],backend='external'),
                     {'id':'item-1','kind':'transfer','amount_minor':100}, {'id':'item-1','kind':{}}]:
            with self.subTest(item=list(item)):
                with self.assertRaises(ContractError):validate_result(proposal('compound',fields={'items':[item]}))
        for action in [{'type':'prepare_compound','authorized':True},{'type':'send_sms'}]:
            with self.assertRaises(ContractError):validate_result(proposal('compound',fields=self.fields(),actions=[action]))

    def test_bounded_slots_dates_ids_and_real_missing_paths(self):
        for fields in [{'items':[]},{'items':self.fields()['items']*4},{'items':[self.fields()['items'][0]]*2}]:
            with self.assertRaises(ContractError):validate_result(proposal('compound',fields=fields))
        for patch in [{'date':'2026-02-30'},{'pickup_time':'25:00'},{'fulfillment':'delivery'},{'source_account':'other'},{'budget_minor':True}]:
            fields=self.fields();fields['items'][1].update(patch)
            with self.assertRaises(ContractError):validate_result(proposal('compound',fields=fields))
        for missing in [['items.2.date'],['items.0.phone'],['items.0.contact_id']]:
            with self.assertRaises(ContractError):validate_result(clarification(fields=self.fields(),missing=missing,scenario='compound'))

    def test_insufficient_cake_budget_remains_known_and_requires_reclarification(self):
        fields=self.fields();fields['items'][1]['budget_minor']=10000
        with self.assertRaises(ContractError):validate_result(proposal('compound',fields=fields))
        result=validate_result(clarification(fields=fields,missing=['items.1.budget_minor'],scenario='compound'))
        self.assertEqual(result['fields']['items'][1]['budget_minor'],10000)

    def test_compound_context_is_only_whitelisted_slots_not_authority_or_ledger(self):
        request={**PAYLOAD,'run_companion':{'scenario':'compound','fields':self.fields(),'missing':[],'plan_id':'proactive-1','revision':2,'status':'needs_confirmation'}}
        context=json.loads(request_messages(request)[-1]['content'].split('\n')[1])
        self.assertEqual(context['run_companion']['fields'],self.fields())
        self.assertEqual(context['run_companion']['plan_id'],'proactive-1')
        for extra in ['authorized','ledger','raw_document']:
            request['run_companion'][extra]=True
            with self.assertRaises(ContractError):request_messages(request)
            del request['run_companion'][extra]


class DraftCancellationContextTests(unittest.TestCase):
    def context(self):
        return {'scenario':'birthday','fields':{'city':'上海'},'missing':['budget_minor'],
                'draft_id':'draft-current-1','revision':1,'status':'clarify'}

    def request_context(self,context,text='算了不办了'):
        messages=request_messages({**PAYLOAD,'text':text,'run_companion':context})
        return json.loads(messages[-1]['content'].split('\n')[1])['run_companion']

    def test_current_uncreated_draft_id_is_metadata_and_not_promoted_into_plan_id(self):
        context=self.request_context(self.context())
        self.assertEqual(context['draft_id'],'draft-current-1')
        self.assertNotIn('plan_id',context)
        self.assertNotIn('draft_id',context['fields'])
        result=validate_result(control('cancel',task_id=context['draft_id']))
        self.assertEqual(result['fields'],{'plan_action':'cancel'})
        self.assertEqual(result['task_id'],'draft-current-1')
        # Completing this draft remains create; only a real plan may update.
        completed=validate_result(proposal('birthday',fields=BIRTHDAY,mode='create',task_id=None))
        self.assertEqual(completed['mode'],'create')
        self.assertIsNone(completed['task_id'])

    def test_draft_id_matches_context_id_bounds_and_rejects_control_values(self):
        for value in ['a'*100,'😀'*50]:
            context=self.context();context['draft_id']=value
            self.assertEqual(self.request_context(context)['draft_id'],value)
        for value in ['', ' ', 42, True, {}, [], 'a'*101, '😀'*51, 'draft\nold', 'draft\x00old', 'draft\x7fold', '\ud800']:
            with self.subTest(value_type=type(value).__name__):
                context=self.context();context['draft_id']=value
                with self.assertRaises(ContractError):self.request_context(context)
        context=self.context();context['draft_id']=None
        self.assertNotIn('draft_id',self.request_context(context))

    def test_extra_context_fields_and_slot_or_action_draft_ids_are_rejected(self):
        for extra in ['grant','authorized','phone','draft_fields']:
            context=self.context();context[extra]='not-authority'
            with self.assertRaises(ContractError):self.request_context(context)
        context=self.context();context['fields']['draft_id']='slot-only-id'
        with self.assertRaises(ContractError):self.request_context(context)
        with self.assertRaises(ContractError):validate_result(control(draft_id='outside-id'))
        with self.assertRaises(ContractError):validate_result(control(actions=[{'type':'control_plan','draft_id':'outside-id'}]))
        with self.assertRaises(ContractError):validate_result(control(fields={'plan_action':'cancel','draft_id':'outside-id'}))

    def test_ordinary_greetings_keep_the_current_draft_context_but_have_no_control_action(self):
        for text in ['hi','你好','谢谢']:
            self.assertEqual(self.request_context(self.context(),text)['draft_id'],'draft-current-1')
            answer=validate_result({'status':'answer','scenario':'other','reply':'你好，有什么交给我？',
                                    'fields':{},'missing':[],'actions':[],'mode':'none','task_id':None})
            self.assertEqual(answer['actions'],[])
            self.assertIsNone(answer['task_id'])
        self.assertIn('pause和resume必须指向已存在的plan_id',SYSTEM_PROMPT)
        self.assertIn('算了不办了',SYSTEM_PROMPT)
        self.assertIn('补齐草稿后仍用mode=create',SYSTEM_PROMPT)

    def test_compound_draft_context_retains_every_request_and_the_outer_id_only(self):
        fields=CompoundContractTests().fields();fields['items'][1]['date']=None
        context={'scenario':'compound','fields':fields,'missing':['items.1.date'],'draft_id':'draft-compound-1','status':'clarify'}
        result=self.request_context(context)
        self.assertEqual(result['draft_id'],'draft-compound-1')
        self.assertEqual(len(result['fields']['items']),2)
        self.assertNotIn('plan_id',result)
        context['fields']['items'][0]['draft_id']='slot-only-id'
        with self.assertRaises(ContractError):self.request_context(context)
