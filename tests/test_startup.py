from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import unittest
from backend import baseline_api

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('finpilot_startup_server',ROOT/'server.py')
server=importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class StartupTests(unittest.TestCase):
    def test_new_database_contains_only_the_explicit_synthetic_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'new.sqlite3'
            result=baseline_api.create_demo_db(target)
            self.assertEqual(result['synthetic_positions'],4)
            self.assertEqual(len(baseline_api.PersonalPositionStore(target).list()['holdings']),4)
            before=hashlib.sha256(target.read_bytes()).hexdigest()
            self.assertIsNone(baseline_api.create_demo_db(target))
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),before)

    def test_existing_data_is_not_opened_or_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'existing.sqlite3';original=b'existing-user-data-sentinel'
            target.write_bytes(original)
            self.assertIsNone(baseline_api.create_demo_db(target))
            self.assertEqual(target.read_bytes(),original)

    def test_production_listener_has_a_bounded_module_burst_backlog(self):
        self.assertEqual(server.FinPilotHTTPServer.request_queue_size,128)
        self.assertTrue(issubclass(server.FinPilotHTTPServer,server.ThreadingHTTPServer))


if __name__=='__main__':unittest.main()
