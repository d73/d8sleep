import json
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

import server


class IdleTests(unittest.TestCase):
    def test_validation_and_corrupt_settings_fail_safe(self):
        for value in (0, 5, 1440):
            self.assertEqual(server.clean_idle({'minutes': value}), {'minutes': value})
        for value in (True, -1, 1, 1441, '5', None):
            with self.assertRaises(ValueError):
                server.clean_idle({'minutes': value})
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'IDLE_PATH', Path(directory) / 'idle.json'):
            self.assertEqual(server.load_idle(), {'minutes': 0})
            server.IDLE_PATH.write_text('{broken', encoding='utf-8')
            self.assertEqual(server.load_idle(), {'minutes': 0})

    def test_http_setting_heartbeat_and_idle_shutdown(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'IDLE_PATH', Path(directory) / 'idle.json'):
            httpd = server.IdleServer(('127.0.0.1', 0), server.Handler)
            thread = threading.Thread(target=httpd.serve_until_idle)
            thread.start()
            port = httpd.server_port
            def request(method, path, data=None):
                connection = HTTPConnection('127.0.0.1', port, timeout=3)
                headers = {'Origin': f'http://127.0.0.1:{port}', 'Content-Type': 'application/json'}
                connection.request(method, path, json.dumps(data) if data is not None else None, headers)
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result
            try:
                self.assertEqual(request('GET', '/api/idle')[1]['minutes'], 0)
                self.assertEqual(request('PUT', '/api/idle', {'minutes': 5})[0], 200)
                self.assertEqual(request('PUT', '/api/idle', {'minutes': True})[0], 400)
                with httpd.activity_lock:
                    httpd.last_activity = time.monotonic() - 299
                self.assertEqual(request('GET', '/api/heartbeat')[0], 200)
                time.sleep(1.2)
                self.assertTrue(thread.is_alive())
                with httpd.activity_lock:
                    httpd.last_activity = time.monotonic() - 301
                thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(json.loads(server.IDLE_PATH.read_text())['minutes'], 5)
            finally:
                if thread.is_alive():
                    httpd.shutdown()
                    thread.join(3)


if __name__ == '__main__':
    unittest.main()
