import json
import math
import re
from datetime import datetime, timedelta, timezone
import os
import time
from urllib import request, error, parse

AUTH = 'https://auth-api.8slp.net/v1/tokens'
CLIENT = 'https://client-api.8slp.net/v1'
APP = 'https://app-api.8slp.net/v1'
# Public client credentials published by the community pyEight client.
CLIENT_ID = '0894c7f33bb94800a03f1f4df13a4f38'
CLIENT_SECRET = 'f0954a3ed5763ba3d06834c73731a32f15f168f47d4f164751275def86db0c76'

class ApiError(Exception):
    pass

class EightClient:
    def __init__(self, email, password, transport=None):
        self.email, self.password = email, password
        self.transport = transport or self._http
        self.token, self.expires, self.sides = None, 0, {}
        self.pod_name = 'Pod'
        self.device_id = None

    @staticmethod
    def _http(method, url, payload=None, token=None):
        headers = {'Accept': 'application/json', 'User-Agent': 'd8sleep/1.0'}
        body = None
        if payload is not None:
            body = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        if token:
            headers['Authorization'] = 'Bearer ' + token
        try:
            with request.urlopen(request.Request(url, data=body, method=method, headers=headers), timeout=20) as response:
                data = response.read()
                return json.loads(data) if data else {}
        except error.HTTPError as exc:
            if exc.code in (401, 403):
                raise ApiError('Authentication failed or access expired.') from exc
            raise ApiError(f'Eight Sleep returned HTTP {exc.code}.') from exc
        except (error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise ApiError('Could not reach Eight Sleep. Check your connection and try again.') from exc

    def authenticate(self):
        result = self.transport('POST', AUTH, {'client_id': os.getenv('EIGHT_CLIENT_ID', CLIENT_ID),
            'client_secret': os.getenv('EIGHT_CLIENT_SECRET', CLIENT_SECRET), 'grant_type': 'password',
            'username': self.email, 'password': self.password}, None)
        try:
            self.token = result['access_token']
            self.expires = time.time() + float(result['expires_in']) - 60
        except (KeyError, ValueError, TypeError) as exc:
            raise ApiError('Unexpected authentication response.') from exc

    def call(self, method, url, payload=None):
        if not self.token or time.time() >= self.expires:
            self.authenticate()
        return self.transport(method, url, payload, self.token)

    def discover(self):
        try:
            devices = self.call('GET', CLIENT + '/users/me')['user']['devices']
            if not devices:
                raise ApiError('No Eight Sleep device found on this account.')
            self.device_id = str(devices[0])
            device = self.call('GET', CLIENT + '/devices/' + parse.quote(self.device_id, safe='') + '?filter=leftUserId,rightUserId,awaySides,modelString')['result']
            self.pod_name = device.get('modelString') or 'Pod'
            ids = {device.get('leftUserId'): 'left', device.get('rightUserId'): 'right'}
            for side, uid in (device.get('awaySides') or {}).items():
                label = {'leftuserid': 'left', 'rightuserid': 'right', 'left': 'left', 'right': 'right', 'solo': 'solo'}.get(side.lower())
                if uid and label:
                    ids[uid] = label
            self.sides = {side: uid for uid, side in ids.items() if uid and side in ('left', 'right', 'solo')}
            if not self.sides:
                raise ApiError('No assigned bed sides were found on this account.')
        except (KeyError, TypeError, AttributeError) as exc:
            raise ApiError('Unexpected device response from Eight Sleep.') from exc
        return self.sides

    def temperature(self, side, payload=None):
        if side not in self.sides:
            raise ApiError('Unknown bed side. Refresh and try again.')
        uid = parse.quote(str(self.sides[side]), safe='')
        return self.call('PUT' if payload is not None else 'GET', APP + '/users/' + uid + '/temperature', payload)

    def status(self):
        if not self.sides:
            self.discover()
        try:
            return self._read_status()
        except ApiError:
            # Side assignments can change. Rediscover once on a read failure;
            # never automatically repeat a temperature or power write.
            self.discover()
            return self._read_status()

    def _read_status(self):
        result = []
        for side in self.sides:
            data = self.temperature(side)
            state = data.get('currentState') or {}
            smart = data.get('smart') or {}
            timed = data.get('timeBased') or {}
            result.append({'side': side, 'power': state.get('type') != 'off' if state.get('type') else None,
                           'target': data.get('currentLevel'), 'current': data.get('currentDeviceLevel'),
                           'mode': state.get('type'), 'mode_started': state.get('started'),
                           'schedule_type': data.get('scheduleType'),
                           'smart': {k: smart.get(k) for k in ('bedTimeLevel', 'initialSleepLevel', 'finalSleepLevel')},
                           'timed': {k: timed.get(k) for k in ('level', 'durationSeconds')}})
        return result

    def device_status(self):
        if not self.device_id:
            self.discover()
        data = self.call('GET', CLIENT + '/devices/' + parse.quote(self.device_id, safe='')).get('result', {})
        # Do not send device IDs, account details or network information to the browser.
        fields = ('online', 'hasWater', 'needsPriming', 'priming', 'isTemperatureAvailable',
                  'lastHeard', 'lastPrime', 'firmwareVersion', 'firmwareUpdating',
                  'leftNowHeating', 'rightNowHeating', 'leftHeatingDuration', 'rightHeatingDuration')
        return {key: data.get(key) for key in fields}

    def session_biometrics(self, side):
        if not self.sides:
            self.discover()
        if side not in self.sides:
            raise ValueError('Unknown bed side.')
        uid = parse.quote(str(self.sides[side]), safe='')
        response = self.call('GET', CLIENT + '/users/' + uid + '/intervals')
        intervals = response.get('intervals') or []

        def timestamp(value):
            if not isinstance(value, str):
                return None
            try:
                dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                return dt.astimezone(timezone.utc).timestamp() if dt.tzinfo else None
            except (ValueError, OverflowError):
                return None

        candidates = [x for x in intervals if isinstance(x, dict) and timestamp(x.get('ts')) is not None]
        if not candidates:
            return None
        candidates.sort(key=lambda x: timestamp(x['ts']), reverse=True)

        def clean(samples):
            if not isinstance(samples, list):
                return []
            valid = [x for x in samples if isinstance(x, (list, tuple)) and len(x) >= 2
                     and timestamp(x[0]) is not None and isinstance(x[1], (int, float))
                     and not isinstance(x[1], bool) and math.isfinite(x[1])]
            valid.sort(key=lambda x: timestamp(x[0]))
            return valid

        def number(value):
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None

        def night(session):
            series = session.get('timeseries') or {}
            if not isinstance(series, dict):
                series = {}
            metrics, all_series = {}, {}
            for key in ('heartRate', 'hrv', 'respiratoryRate', 'tempBedC', 'tempRoomC'):
                valid = clean(series.get(key))
                metrics[key] = {'timestamp': valid[-1][0], 'value': valid[-1][1]} if valid else None
                all_series[key] = [{'timestamp': point[0], 'value': point[1]} for point in valid]
            # respiratoryRate holds one nightly value; the hourly curve is nemeanRespiratoryRate.
            hourly = clean(series.get('nemeanRespiratoryRate'))
            if len(hourly) > len(all_series['respiratoryRate']):
                all_series['respiratoryRate'] = [{'timestamp': point[0], 'value': point[1]} for point in hourly]
            stages = []
            for item in session.get('stages') if isinstance(session.get('stages'), list) else []:
                if isinstance(item, dict) and item.get('stage') in ('awake', 'light', 'deep', 'rem', 'out') and number(item.get('duration')) is not None:
                    stages.append({'stage': item['stage'], 'duration': item['duration']})
            summary_raw = session.get('stageSummary') if isinstance(session.get('stageSummary'), dict) else {}
            summary = {key: number(summary_raw.get(key)) for key in
                       ('totalDuration', 'sleepDuration', 'outDuration', 'awakeDuration', 'lightDuration', 'deepDuration', 'remDuration')}
            score = number(session.get('score'))
            return {'start': session.get('ts'), 'presence_end': session.get('presenceEnd'),
                    'sleep_start': session.get('sleepStart') if timestamp(session.get('sleepStart')) is not None else None,
                    'sleep_end': session.get('sleepEnd') if timestamp(session.get('sleepEnd')) is not None else None,
                    'duration': number(session.get('duration')),
                    'score': score if score else None,
                    'stages': stages, 'stage_summary': summary,
                    'incomplete': session.get('incomplete') if isinstance(session.get('incomplete'), bool) else None,
                    'metrics': metrics, 'heart_rate_series': all_series['heartRate'], 'series': all_series}

        chosen = candidates[:14]
        sessions = [night(x) for x in chosen]
        scores = self._daily_scores(uid, chosen, timestamp)
        for item, raw in zip(sessions, chosen):
            if item['score'] is None:
                item['score'] = scores.get(str(raw.get('id')))
        return {**sessions[0], 'sessions': sessions}

    def _daily_scores(self, uid, intervals, timestamp):
        """Sleep scores come from /trends (per day, keyed by the day's main session); /intervals reports 0."""
        try:
            stamps = [timestamp(x['ts']) for x in intervals]
            zone = next((x.get('timezone') for x in intervals if isinstance(x.get('timezone'), str)
                         and re.fullmatch(r'[A-Za-z_]+(/[A-Za-z_+-]+)+', x['timezone'])), 'UTC')
            first = datetime.fromtimestamp(min(stamps), timezone.utc).date() - timedelta(days=1)
            last = datetime.fromtimestamp(max(stamps), timezone.utc).date() + timedelta(days=1)
            url = (CLIENT + '/users/' + uid + '/trends?tz=' + parse.quote(zone, safe='/') + '&from=' + first.isoformat() + '&to=' + last.isoformat()
                   + '&include-main=false&include-all-sessions=true&model-version=v2')
            days = self.call('GET', url).get('days') or []
        except (ApiError, AttributeError, KeyError, TypeError, ValueError):
            return {}
        scores = {}
        for day in days:
            if isinstance(day, dict) and isinstance(day.get('score'), (int, float)) and not isinstance(day.get('score'), bool) and math.isfinite(day['score']) and day['score'] > 0:
                scores[str(day.get('mainSessionId'))] = day['score']
        return scores

    def set_level(self, side, level):
        if isinstance(level, bool) or not isinstance(level, int) or not -100 <= level <= 100:
            raise ValueError('Level must be a whole number from -100 to 100.')
        self.temperature(side, {'currentLevel': level})

    def set_power(self, side, on):
        if not isinstance(on, bool):
            raise ValueError('Power must be on or off.')
        self.temperature(side, {'currentState': {'type': 'smart' if on else 'off'}})
