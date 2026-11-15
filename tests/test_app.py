import json
import threading
import unittest
from http.client import HTTPConnection
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server
from eight import EightClient, ApiError

class FakeTransport:
    def __init__(self): self.calls = []
    def __call__(self, method, url, payload, token):
        self.calls.append((method, url, payload, token))
        if '/tokens' in url: return {'access_token':'test-token','expires_in':3600}
        if url.endswith('/users/me'): return {'user':{'devices':['device']}}
        if '/devices/' in url: return {'result':{'leftUserId':'left-id','rightUserId':'right-id','modelString':'Pod 4'}}
        if method == 'GET' and '/temperature' in url: return {'currentState':{'type':'smart'},'currentLevel':-20,'currentDeviceLevel':-15}
        return {}

class ClientTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeTransport()
        self.client = EightClient('a', 'b', self.fake)
    def test_discovery_status_and_authenticated_requests(self):
        sides = self.client.status()
        self.assertEqual({s['side'] for s in sides}, {'left', 'right'})
        self.assertEqual(self.client.pod_name, 'Pod 4')
        self.assertEqual(sides[0]['target'], -20)
        self.assertEqual(sides[0]['current'], -15)
        self.assertTrue(all(call[3] == 'test-token' for call in self.fake.calls[1:]))
    def test_discovery_handles_away_side_user_id_keys(self):
        original = self.client.transport
        def away_device(method, url, payload, token):
            if '/devices/' in url:
                return {'result': {'leftUserId': 'left-id', 'rightUserId': 'right-id',
                                   'awaySides': {'leftUserId': 'left-id', 'rightUserId': 'right-id'}}}
            return original(method, url, payload, token)
        self.client.transport = away_device
        self.assertEqual(self.client.discover(), {'left': 'left-id', 'right': 'right-id'})

    def test_control_targets_selected_side_and_validates_input(self):
        self.client.discover()
        self.client.set_level('right', -33)
        self.assertTrue(self.fake.calls[-1][1].endswith('/users/right-id/temperature'))
        self.assertEqual(self.fake.calls[-1][2], {'currentLevel':-33})
        self.client.set_power('left', False)
        self.assertEqual(self.fake.calls[-1][2], {'currentState':{'type':'off'}})
        with self.assertRaises(ValueError): self.client.set_level('left', 101)
        with self.assertRaises(ValueError): self.client.set_level('left', True)
        with self.assertRaises(ApiError): self.client.set_level('other', 1)
    def test_status_caches_discovery_and_recovers_from_read_failure(self):
        self.client.status()
        self.client.status()
        self.assertEqual(sum(c[1].endswith('/users/me') for c in self.fake.calls), 1)
        original = self.client.transport
        failed = False
        def fail_once(method, url, payload, token):
            nonlocal failed
            if '/temperature' in url and not failed:
                failed = True
                raise ApiError('stale side')
            return original(method, url, payload, token)
        self.client.transport = fail_once
        self.assertEqual(len(self.client.status()), 2)
        self.assertEqual(sum(c[1].endswith('/users/me') for c in self.fake.calls), 2)

    def test_device_status_is_allowlisted_and_handles_missing_fields(self):
        original = self.client.transport
        def device_response(method, url, payload, token):
            if '/devices/' in url and '?' not in url:
                return {'result': {'online': True, 'hasWater': False, 'deviceId': 'private-id', 'wifiInfo': {'password': 'private'}}}
            return original(method, url, payload, token)
        self.client.transport = device_response
        result = self.client.device_status()
        self.assertTrue(result['online'])
        self.assertFalse(result['hasWater'])
        self.assertIsNone(result['priming'])
        self.assertNotIn('deviceId', result)
        self.assertNotIn('wifiInfo', result)

    def test_refreshes_expired_token(self):
        self.client.discover()
        self.client.expires = 0
        self.client.temperature('left')
        self.assertEqual(sum('/tokens' in c[1] for c in self.fake.calls), 2)

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.thread.join()
    def request(self, path, body, origin=None):
        port = self.httpd.server_port
        conn=HTTPConnection('127.0.0.1', port)
        conn.request('POST', path, json.dumps(body), {'Content-Type':'application/json','Origin':origin or f'http://127.0.0.1:{port}'})
        res=conn.getresponse(); data=json.loads(res.read()); conn.close(); return res.status, data
    def test_host_validation_blocks_dns_rebinding(self):
        self.assertFalse(server.valid_host('attacker.example:8787'))
        self.assertTrue(server.valid_host('192.168.1.2:8787'))
        self.assertTrue(server.valid_host('localhost:8787'))

    def test_rejects_cross_origin(self):
        status,_ = self.request('/api/login', {'email':'a','password':'b'}, 'http://evil.test')
        self.assertEqual(status, 403)
    def test_device_endpoint_exposes_safe_status(self):
        fake=FakeTransport()
        server.client=EightClient('a', 'b', fake)
        conn=HTTPConnection('127.0.0.1', self.httpd.server_port)
        try:
            conn.request('GET', '/api/device')
            res=conn.getresponse(); data=json.loads(res.read())
            self.assertEqual(res.status, 200)
            self.assertIn('online', data['device'])
            self.assertNotIn('leftUserId', data['device'])
        finally:
            conn.close(); server.client=None

    def test_control_with_fake_upstream(self):
        fake=FakeTransport()
        server.client = EightClient('a', 'b', fake)
        server.client.discover()
        status,_=self.request('/api/level', {'side':'left','level':101})
        self.assertEqual(status,400)
        status,_=self.request('/api/power', {'side':'right','on':False})
        self.assertEqual(status,200)
        self.assertTrue(any(c[2]=={'currentState':{'type':'off'}} for c in fake.calls))
        server.client = None

if __name__ == '__main__': unittest.main()
