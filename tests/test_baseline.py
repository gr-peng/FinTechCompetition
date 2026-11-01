from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from backend import baseline_api
from baseline_backend.personal_positions import PersonalPositionStore, PositionConflict
from baseline_backend.market_reference import MarketReference


class BaselineTests(unittest.TestCase):
    def test_copied_position_store_crud_and_revision_are_isolated(self):
        with tempfile.TemporaryDirectory(dir=baseline_api.ROOT / '.runtime') as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(baseline_api.ROOT.resolve()))
            store = PersonalPositionStore(Path(folder) / 'positions.sqlite3')
            market = MarketReference(baseline_api.ROOT / 'web/assets/research')
            with patch.object(baseline_api, '_positions', store), patch.object(baseline_api, '_market', market):
                initial = baseline_api.read('/api/positions')
                p = {'code': '600036', 'name': '招商银行', 'asset_class': 'stock', 'quantity': '200', 'total_cost': '8019.84', 'currency': 'CNY', 'as_of': '2026-10-23'}
                baseline_api.mutate('POST', '/api/positions', {'position': p, 'expected_revision': initial['revision']})
                result = baseline_api.read('/api/positions')
                self.assertEqual(result['total_cost'], '8019.84')
                self.assertEqual(result['market_value'], '8354.00')
                with self.assertRaises(PositionConflict):
                    baseline_api.mutate('POST', '/api/positions', {'position': p, 'expected_revision': initial['revision']})
                baseline_api.mutate('DELETE', '/api/positions/' + result['holdings'][0]['id'], {'expected_revision': result['revision']})
                self.assertEqual(baseline_api.read('/api/positions')['holdings'], [])

    def test_original_market_references_are_local_ten_stock_records(self):
        market = MarketReference(baseline_api.ROOT / 'web/assets/research')
        self.assertEqual(len(market.watchlist()), 10)
        self.assertGreaterEqual(len(market.history('600036', 90)), 30)


if __name__ == '__main__':
    unittest.main()
