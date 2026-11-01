import unittest
from backend.agent_contract import validate_result, ContractError

def proposal(amount=30000):
    return dict(status='propose',scenario='security_case',reply='请核对这次转账。',
        fields=dict(case_id='unfamiliar_recipient',recipient_name='陈宇',recipient_card_number='0000000000006217',amount_minor=amount,source_account='living_1608'),
        missing=[],mode='create',task_id=None,actions=[{'type':'show_security_case'}],cards=[{'type':'security_notice'}])

class ReplyAmountTests(unittest.TestCase):
    def test_lossless_numeric_representation(self):
        for value in (30000,'30000',30000.0):
            result=validate_result(proposal(value))
            self.assertEqual(result['fields']['amount_minor'],30000)
            self.assertIs(type(result['fields']['amount_minor']),int)
            self.assertEqual(result['fields']['recipient_card_number'],'0000000000006217')
    def test_no_unit_guess_or_fraction_rounding(self):
        for value in ('300元','300.00','3e4',True,30000.1,-1,'2000000001'):
            with self.assertRaises(ContractError):validate_result(proposal(value))
    def test_missing_security_case_is_not_invented(self):
        value=proposal();del value['fields']['case_id']
        with self.assertRaises(ContractError):validate_result(value)
