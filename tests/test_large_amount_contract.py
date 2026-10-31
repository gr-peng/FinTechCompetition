import unittest
from agent_contract import validate_result, ContractError

class LargeAmountContract(unittest.TestCase):
    def test_large_risk_amount_is_not_a_schema_failure(self):
        result=validate_result({'status':'blocked','scenario':'risk_transfer','reply':'不能转入安全账户。','fields':{'amount_minor':5000000},'missing':[],'mode':'none'})
        self.assertEqual(result['fields']['amount_minor'],5000000)
    def test_malformed_or_excessive_amount_remains_rejected(self):
        for amount in (2000000001,1.5,-1):
            with self.subTest(amount=amount),self.assertRaises(ContractError):
                validate_result({'status':'blocked','scenario':'risk_transfer','reply':'核对','fields':{'amount_minor':amount},'missing':[],'mode':'none'})
