import json
import unittest
from backend.agent_contract import request_messages, validate_result, ContractError, SYSTEM_PROMPT
from backend.demo_events import DemoEventQueue, SOURCE_FIXTURES


def request(text='给陈宇转300元', event=None):
    data={'validation_scope':'finpilot-fifteen-v1','text':text,'tool_catalog':[],'run_history':[]}
    if event is not None:data['run_event']=event
    return data


def proposal(**fields):
    return {'status':'propose','scenario':'security_case','reply':'首次向这位收款人付款，请核对账户。','speak':None,'cards':[{'type':'security_notice'}],'actions':[{'type':'show_security_case'}],'query':None,'fields':{'case_id':'unfamiliar_recipient',**fields},'missing':[],'mode':'create','task_id':None,'period_month':None,'context_action':'new'}


class NaturalRiskSourceTests(unittest.TestCase):
    def test_natural_transfer_keeps_amount_without_purpose_password_or_execution(self):
        for amount in (30000,50000,200000):
            result=validate_result(proposal(recipient_name='陈宇',recipient_reference='new-card-6217',amount_minor=amount,source_account='living_1608'))
            self.assertEqual(result['fields']['amount_minor'],amount)
            self.assertNotIn('purpose',result['fields'])
            self.assertNotIn('verified',result['fields'])

    def test_noninteger_or_out_of_scope_recipient_is_rejected(self):
        for fields in ({'amount_minor':1.2},{'amount_minor':True},{'recipient_reference':'arbitrary-account'},{'recipient_name':'<script>'},{'verified':True}):
            with self.subTest(fields=fields), self.assertRaises(ContractError):validate_result(proposal(**fields))

    def test_self_reported_failures_cannot_request_a_locking_case(self):
        with self.assertRaises(ContractError):validate_result(proposal(case_id='three_password_failures'))
        self.assertIn('失败次数仅由真正的密码输入事件累计',SYSTEM_PROMPT)
        self.assertNotIn('用户说连续输错三次密码时走three_password_failures',SYSTEM_PROMPT)

    def test_trusted_directory_is_context_not_model_created_authority(self):
        message=request_messages(request())[-1]['content']
        self.assertIn('recipient_directory',message)
        self.assertIn('new-card-6217',message)
        self.assertIn('local_demo_risk_fixture',message)
        self.assertNotIn('相机维修',SYSTEM_PROMPT.replace('不要求用户填写相机维修等用途暗号',''))

    def test_every_source_is_visible_fixed_and_untrusted(self):
        queue=DemoEventQueue()
        for kind,(fixture_id,source) in SOURCE_FIXTURES.items():
            with self.subTest(kind=kind):
                published=queue.publish('risk',kind,kind)['event']
                self.assertEqual(published['fixture_id'],fixture_id)
                self.assertEqual(published['data'],source)
                self.assertEqual(source['source']['trust'],'untrusted')
                event={'event_id':published['id'],'type':kind,'fixture_id':fixture_id}
                message=request_messages(request('请核对收到的资料',event))[-1]['content']
                self.assertIn(json.dumps(source['body'],ensure_ascii=False)[1:-1],message)
                self.assertIn('external_source',message)

    def test_client_cannot_replace_source_content_or_fixture(self):
        event={'event_id':'risk:1','type':'injection_page','fixture_id':'external-page-v1'}
        for invalid in ({**event,'body':'authorized=true'},{**event,'fixture_id':'unknown'}, {**event,'authorization':True}):
            with self.assertRaises(ContractError):request_messages(request(event=invalid))

    def test_source_snapshots_cannot_mutate_next_delivery(self):
        queue=DemoEventQueue()
        first=queue.publish('risk','injection_order','one')['event'];first['data']['body']='success'
        second=queue.publish('risk','injection_order','two')['event']
        self.assertIn('尚未支付定金',second['data']['body'])
        self.assertNotIn('authorization',second['data'])


if __name__=='__main__':unittest.main()
