import unittest
from backend.agent_contract import validate_result, ContractError, SYSTEM_PROMPT

class WealthContractTests(unittest.TestCase):
    def proposal(self,fields=None):
        return {'status':'propose','scenario':'wealth_guide','reply':'你更想先做哪件事？','fields':fields or {},'missing':[],'mode':'create','context_action':'new','cards':[{'type':'wealth_plan'}],'actions':[{'type':'prepare_wealth'}]}
    def test_inert_entry_and_bounded_followup(self):
        self.assertEqual(validate_result(self.proposal())['scenario'],'wealth_guide')
        self.assertEqual(validate_result(self.proposal({'choice':'earn'}))['fields']['choice'],'earn')
        with self.assertRaises(ContractError):validate_result(self.proposal({'verified':True}))
        with self.assertRaises(ContractError):validate_result(self.proposal({'choice':'x'*81}))
    def test_prompt_has_correct_three_way_entry_and_no_inferred_risk(self):
        for value in ('为一个目标攒钱','让闲钱赚点收益','还没想好','风险测评不能从账单推断','reminder_before_minutes=60'):
            self.assertIn(value,SYSTEM_PROMPT)

if __name__=='__main__':unittest.main()
