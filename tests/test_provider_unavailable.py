import unittest
from unittest.mock import Mock
from agent_provider import run_provider, ProviderError

class UnavailableTests(unittest.TestCase):
    def test_503_is_not_auth_failure_and_never_retries_or_echoes_provider_body(self):
        conn = Mock()
        response = Mock(status=503)
        response.read.return_value = b'private upstream diagnostic must not be echoed'
        conn.getresponse.return_value = response
        payload = {'validation_scope':'finpilot-fifteen-v1','text':'hi','tool_catalog':[], 'run_history':[]}
        with self.assertRaises(ProviderError) as caught:
            run_provider(payload, 'unit-test-only', 'deepseek-flash', 'test', lambda *a, **k: conn)
        error = caught.exception
        self.assertEqual(error.code, 'provider_error')
        self.assertEqual(error.diagnostic['upstream_status'], 503)
        self.assertFalse(error.diagnostic['completed'])
        self.assertIn('503', error.message)
        self.assertIn('无需因此重填密钥', error.message)
        self.assertNotIn('private upstream', error.message)
        conn.request.assert_called_once()
        conn.close.assert_called_once()
