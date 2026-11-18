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

    def test_session_biometrics_selects_latest_and_allowlists_data(self):
        original = self.client.transport
        def transport(method, url, payload, token):
            if url.endswith('/intervals'):
                return {'intervals': [
                    {'ts': '2026-01-01T00:00:00Z', 'timeseries': {}},
                    {'ts': '2026-01-02T00:00:00Z', 'presenceEnd': '2026-01-02T02:00:00Z',
                     'incomplete': True, 'device': {'id': 'secret-device'}, 'id': 'secret-session',
                     'timeseries': {'heartRate': [['2026-01-02T01:20:00Z', 60], ['bad-date', 70], ['2026-01-02T01:10:00Z', True], ['2026-01-02T01:00:00Z', 55]],
                                    'hrv': [['bad-date', 1]], 'tempBedC': [['2026-01-02T01:00:00Z', 25.5]]}}
                ]}
            return original(method, url, payload, token)
        self.client.transport = transport
        result = self.client.session_biometrics('left')
        self.assertEqual(result['start'], '2026-01-02T00:00:00Z')
        self.assertEqual(result['metrics']['heartRate']['value'], 60)
        self.assertEqual(result['heart_rate_series'], [{'timestamp':'2026-01-02T01:00:00Z','value':55}, {'timestamp':'2026-01-02T01:20:00Z','value':60}])
        self.assertEqual(result['metrics']['tempBedC']['value'], 25.5)
        self.assertEqual(result['series']['tempBedC'], [{'timestamp': '2026-01-02T01:00:00Z', 'value': 25.5}])
        self.assertEqual(result['series']['heartRate'], result['heart_rate_series'])
        self.assertEqual(result['series']['hrv'], [])
        self.assertEqual(set(result['series']), {'heartRate', 'hrv', 'respiratoryRate', 'tempBedC', 'tempRoomC'})
        self.assertIsNone(result['metrics']['hrv'])
        self.assertIsNone(result['metrics']['tempRoomC'])
        self.assertNotIn('id', result)
        self.assertNotIn('device', result)
        with self.assertRaises(ValueError): self.client.session_biometrics('unknown')

    def test_respiratory_chart_uses_the_hourly_series_when_the_nightly_value_is_single(self):
        original = self.client.transport
        def transport(method, url, payload, token):
            if url.endswith('/intervals'):
                return {'intervals': [{'ts': '2026-01-02T00:00:00Z', 'timeseries': {
                    'respiratoryRate': [['2026-01-02T00:30:00Z', 15.5]],
                    'nemeanRespiratoryRate': [['2026-01-02T01:00:00Z', 16.0], ['2026-01-02T00:00:00Z', 15.0], ['bad', 1]]}}]}
            return original(method, url, payload, token)
        self.client.transport = transport
        result = self.client.session_biometrics('left')
        self.assertEqual(result['metrics']['respiratoryRate']['value'], 15.5)  # snapshot card unchanged
        self.assertEqual(result['series']['respiratoryRate'], [{'timestamp': '2026-01-02T00:00:00Z', 'value': 15.0}, {'timestamp': '2026-01-02T01:00:00Z', 'value': 16.0}])

    def test_sessions_list_newest_first_with_stages_score_and_clean_fields(self):
        original = self.client.transport
        def interval(ts, **extra):
            return {'ts': ts, 'timeseries': {}, **extra}
        def transport(method, url, payload, token):
            if url.endswith('/intervals'):
                return {'intervals': [
                    interval('2026-01-01T00:00:00Z', score=0),
                    interval('2026-01-03T00:00:00Z', score=88, duration=27000, sleepStart='2026-01-03T00:30:00Z', sleepEnd='2026-01-03T07:00:00Z',
                             id='secret', device={'id': 'secret-device'},
                             stages=[{'stage': 'awake', 'duration': 600}, {'stage': 'deep', 'duration': 3600}, {'stage': 'bogus', 'duration': 5}, {'stage': 'rem', 'duration': -1}, {'stage': 'light', 'duration': 'x'}],
                             stageSummary={'sleepDuration': 16200, 'totalDuration': 27000, 'deepDuration': 3600, 'unknown': 9}),
                    interval('2026-01-02T00:00:00Z', score=70),
                    {'ts': 'bad'},
                ]}
            return original(method, url, payload, token)
        self.client.transport = transport
        result = self.client.session_biometrics('left')
        self.assertEqual([x['start'] for x in result['sessions']], ['2026-01-03T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'])
        self.assertEqual(result['start'], '2026-01-03T00:00:00Z')  # top level mirrors the latest night
        latest = result['sessions'][0]
        self.assertEqual(latest['score'], 88)
        self.assertIsNone(result['sessions'][2]['score'])  # a score of 0 means not reported
        self.assertEqual(latest['stages'], [{'stage': 'awake', 'duration': 600}, {'stage': 'deep', 'duration': 3600}])
        self.assertEqual(latest['stage_summary']['sleepDuration'], 16200)
        self.assertNotIn('unknown', latest['stage_summary'])
        self.assertEqual(latest['sleep_start'], '2026-01-03T00:30:00Z')
        self.assertEqual(latest['duration'], 27000)
        self.assertNotIn('id', latest); self.assertNotIn('device', latest)

    def test_sleep_score_comes_from_trends_by_main_session_and_failure_is_harmless(self):
        original = self.client.transport
        urls = []
        def make(trends):
            def transport(method, url, payload, token):
                if url.endswith('/intervals'):
                    return {'intervals': [
                        {'id': '111', 'ts': '2026-01-02T00:00:00Z', 'score': 0, 'timezone': 'America/Los_Angeles', 'timeseries': {}},
                        {'id': '222', 'ts': '2026-01-01T00:00:00Z', 'score': 0, 'timezone': 'America/Los_Angeles', 'timeseries': {}},
                        {'id': '333', 'ts': '2025-12-31T00:00:00Z', 'score': 0, 'timeseries': {}}]}
                if '/trends' in url:
                    urls.append(url)
                    return trends()
                return original(method, url, payload, token)
            return transport
        self.client.transport = make(lambda: {'days': [
            {'day': '2026-01-02', 'score': 90, 'mainSessionId': '111', 'sessionIds': ['111', '999']},
            {'day': '2026-01-01', 'score': 0, 'mainSessionId': '222'},
            {'day': '2025-12-31', 'score': True, 'mainSessionId': '333'}, {'bad': 1}]})
        result = self.client.session_biometrics('left')
        self.assertEqual([x['score'] for x in result['sessions']], [90, None, None])  # 0 and non-numeric scores are not reported
        self.assertEqual(result['score'], 90)
        self.assertIn('tz=America/Los_Angeles', urls[0])
        self.assertIn('from=2025-12-30', urls[0]); self.assertIn('to=2026-01-03', urls[0])
        def broken():
            raise ApiError('trends down')
        self.client.transport = make(broken)
        result = self.client.session_biometrics('left')  # scores unavailable, sessions still load
        self.assertEqual([x['score'] for x in result['sessions']], [None, None, None])
        self.client.transport = make(lambda: {'days': 'not a list'})
        self.assertEqual(self.client.session_biometrics('left')['score'], None)

    def test_session_biometrics_empty_response(self):
        original = self.client.transport
        self.client.transport = lambda method,url,payload,token: {'intervals': []} if url.endswith('/intervals') else original(method,url,payload,token)
        self.assertIsNone(self.client.session_biometrics('left'))

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

    def test_post_requires_this_pc(self):
        self.assertTrue(server.local_client('127.0.0.1'))
        self.assertTrue(server.local_client('::ffff:127.0.0.1'))
        self.assertFalse(server.local_client('192.168.1.250'))
        self.assertFalse(server.local_client('8.8.8.8'))
        with patch.object(server, 'local_client', return_value=False):
            status, data = self.request('/api/power', {'side': 'left', 'on': True})
        self.assertEqual(status, 403)
        self.assertIn('Read-only', data['error'])

    def put(self, body, headers=None, host_origin=True):
        port = self.httpd.server_port
        conn = HTTPConnection('127.0.0.1', port)
        head = {'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{port}'}
        head.update(headers or {})
        conn.request('PUT', '/api/prefs', body if isinstance(body, str) else json.dumps(body), head)
        res = conn.getresponse(); data = json.loads(res.read()); conn.close(); return res.status, data

    def get_prefs(self):
        conn = HTTPConnection('127.0.0.1', self.httpd.server_port)
        conn.request('GET', '/api/prefs')
        res = conn.getresponse(); data = json.loads(res.read()); conn.close(); return res.status, data

    def test_prefs_validate_persist_and_reload(self):
        import tempfile, pathlib
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'PREFS_PATH', pathlib.Path(tmp) / 'data' / 'prefs.json'):
            status, data = self.get_prefs()
            self.assertEqual(status, 200)
            self.assertEqual(data['prefs']['active'], ['heartRate'])
            self.assertEqual(data['prefs']['colors']['hrv'], server.DEFAULT_COLORS['hrv'])
            status, data = self.put({'colors': {'heartRate': '#ABCDEF'}, 'active': ['hrv', 'heartRate']})
            self.assertEqual(status, 200)
            self.assertEqual(data['prefs']['colors']['heartRate'], '#abcdef')
            self.assertEqual(data['prefs']['active'], ['heartRate', 'hrv'])
            self.assertEqual(self.get_prefs()[1]['prefs'], data['prefs'])
            self.assertEqual(server.load_prefs(), data['prefs'])  # survives a restart: read from disk
            for bad in ({'colors': {'heartRate': 'red'}}, {'colors': {'bogus': '#000000'}}, {'active': ['nope']}, {'active': ['hrv', 'hrv']}, {'colors': []}, []):
                self.assertEqual(self.put(bad)[0], 400, bad)
            self.assertEqual(self.get_prefs()[1]['prefs'], data['prefs'])
            status, data = self.put({'stageColors': {'deep': '#0A0B0C'}})
            self.assertEqual(status, 200)
            self.assertEqual(data['prefs']['stageColors']['deep'], '#0a0b0c')
            self.assertEqual(data['prefs']['stageColors']['rem'], server.DEFAULT_STAGE_COLORS['rem'])
            status, data = self.put({'order': ['tempBedC', 'hrv'], 'stageColors': {'deep': '#0A0B0C'}})  # a PUT replaces all preferences
            self.assertEqual(status, 200)
            self.assertEqual(data['prefs']['order'], ['tempBedC', 'hrv', 'heartRate', 'respiratoryRate', 'tempRoomC'])  # the rest follow in default order
            self.assertEqual(server.load_prefs()['order'], data['prefs']['order'])
            for bad in ({'order': ['nope']}, {'order': ['hrv', 'hrv']}, {'order': 'hrv'}):
                self.assertEqual(self.put(bad)[0], 400, bad)
            for bad in ({'stageColors': {'deep': 'blue'}}, {'stageColors': {'bogus': '#000000'}}, {'stageColors': []}):
                self.assertEqual(self.put(bad)[0], 400, bad)
            self.assertEqual(server.load_prefs()['stageColors']['deep'], '#0a0b0c')

    def test_prefs_write_needs_this_pc_origin_and_json(self):
        import tempfile, pathlib
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'PREFS_PATH', pathlib.Path(tmp) / 'prefs.json'):
            self.assertEqual(self.put({'active': ['hrv']}, {'Origin': 'http://evil.example'})[0], 403)
            self.assertEqual(self.put({'active': ['hrv']}, {'Content-Type': 'text/plain'})[0], 403)
            with patch.object(server, 'local_client', return_value=False):
                self.assertEqual(self.put({'active': ['hrv']})[0], 403)
            self.assertFalse((pathlib.Path(tmp) / 'prefs.json').exists())

    def test_corrupt_prefs_file_falls_back_to_defaults(self):
        import tempfile, pathlib
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'prefs.json'
            path.write_text('{not json', encoding='utf-8')
            self.assertEqual(server.load_prefs(path), server.clean_prefs({}))

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

    def test_session_endpoint_validates_side_and_hides_identifiers(self):
        fake=FakeTransport()
        def transport(method,url,payload,token):
            if url.endswith('/intervals'):
                return {'intervals': [{'ts':'2026-01-02T00:00:00Z','id':'private','timeseries':{'hrv':[['2026-01-02T01:00:00Z',42]], 'heartRate':[['2026-01-02T01:02:00Z', 70], ['2026-01-02T01:00:00Z', 68]]}}]}
            return fake(method,url,payload,token)
        server.client=EightClient('a', 'b', transport)
        conn=HTTPConnection('127.0.0.1', self.httpd.server_port)
        try:
            conn.request('GET', '/api/session?side=left')
            res=conn.getresponse(); data=json.loads(res.read())
            self.assertEqual(res.status, 200)
            self.assertEqual(data['session']['metrics']['hrv']['value'],42)
            self.assertEqual([p['value'] for p in data['session']['heart_rate_series']], [68,70])
            self.assertNotIn('private', json.dumps(data))
            conn.request('GET', '/api/session?side=invalid')
            res=conn.getresponse();res.read();self.assertEqual(res.status,400)
        finally:
            conn.close();server.client=None

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
