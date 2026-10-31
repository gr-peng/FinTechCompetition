import unittest
from agent_contract import validate_result,request_messages,ContractError,SYSTEM_PROMPT

class R14Contract(unittest.TestCase):
    def test_savings_initial_is_a_real_proposal_without_invented_amount(self):
        r=validate_result({'scenario':'savings_coach','status':'propose','reply':'先看上月支出和建议。','fields':{},'missing':[],'actions':[{'type':'prepare_savings'}],'cards':[{'type':'savings_plan'}]})
        self.assertEqual(r['scenario'],'savings_coach')
        self.assertIn('优先路由',SYSTEM_PROMPT)
        self.assertIn('不要仅用 other/answer',SYSTEM_PROMPT)
    def test_bounded_aggregate_context_preserves_stage_and_existing_answers(self):
        c={'scenario':'savings_coach','stage':'details','revision':1,'draft_id':'saving-1','status':'clarify','fields':{'reduction_minor':60000,'daily_minor':2000},'missing':['source_account','start_date','target_minor'],'analysis':{'period':'2026-10','total_minor':10000,'categories':[{'category':'购物','amount_minor':10000,'ratio':1}]}}
        payload={'text':'生活账户，明天开始，目标一万二','tool_catalog':[],'run_companion':c}
        messages=request_messages(payload)
        self.assertIn('2026-10',messages[-1]['content'])
        c['analysis']['ledger']=[{'private':'not allowed'}]
        with self.assertRaises(ContractError):request_messages(payload)
    def test_ride_and_sms_both_survive_validation(self):
        fields={'items':[{'id':'item-1','kind':'sms','contact_id':'mom','message':'周末回家吃饭。'},{'id':'item-2','kind':'ride','date':'2026-11-07','departure_time':'17:00','origin':'学校南门','destination':'家小区北门','fare_minor':8000,'source_account':'living_1608'}]}
        r=validate_result({'scenario':'compound','status':'propose','reply':'先核对短信，再安排车辆。','fields':fields,'missing':[],'actions':[{'type':'prepare_compound'}],'cards':[{'type':'compound_plan'}]})
        self.assertEqual(len(r['fields']['items']),2)
        self.assertEqual(r['fields']['items'][1]['fare_minor'],8000)

if __name__=='__main__':unittest.main()
