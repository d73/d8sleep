import ipaddress
import json
import os
import re
import socket
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock, Thread
from urllib.parse import urlsplit, parse_qs
from eight import EightClient, ApiError

ROOT = Path(__file__).resolve().parent
lock = RLock()
PREFS_PATH = ROOT / 'data' / 'prefs.json'
IDLE_PATH = ROOT / 'data' / 'idle.json'
STREAMS = ('heartRate', 'hrv', 'tempBedC', 'respiratoryRate', 'tempRoomC')
DEFAULT_COLORS = {'heartRate': '#e57373', 'hrv': '#64b5f6', 'tempBedC': '#ffb74d', 'respiratoryRate': '#4db6ac', 'tempRoomC': '#9575cd'}
STAGES = ('deep', 'rem', 'light', 'awake')
DEFAULT_STAGE_COLORS = {'deep': '#5c6bc0', 'rem': '#ba68c8', 'light': '#4fc3f7', 'awake': '#ffb74d'}
DEFAULT_PREFS = {'colors': dict(DEFAULT_COLORS), 'active': ['heartRate'], 'stageColors': dict(DEFAULT_STAGE_COLORS), 'order': list(STREAMS)}
client = None

def clean_idle(data):
    value = data.get('minutes') if isinstance(data, dict) else None
    if type(value) is not int or (value != 0 and not 5 <= value <= 1440):
        raise ValueError('Idle timeout must be 0 or 5–1440 minutes.')
    return {'minutes': value}

def load_idle():
    try:
        return clean_idle(json.loads(IDLE_PATH.read_text(encoding='utf-8')))
    except (OSError, ValueError):
        return {'minutes': 0}

class IdleServer(ThreadingHTTPServer):
    def __init__(self, *args):
        super().__init__(*args)
        self.activity_lock = RLock()
        self.last_activity = time.monotonic()
        self.active_requests = 0

    def begin_request(self):
        with self.activity_lock:
            self.active_requests += 1
            self.last_activity = time.monotonic()

    def end_request(self):
        with self.activity_lock:
            self.active_requests -= 1
            self.last_activity = time.monotonic()

    def stop_when_idle(self):
        while not self.idle_stop.wait(1):
            minutes = load_idle()['minutes']
            with self.activity_lock:
                if minutes and not self.active_requests and time.monotonic() - self.last_activity >= minutes * 60:
                    self.shutdown()
                    return

    def serve_until_idle(self):
        from threading import Event
        self.idle_stop = Event()
        watcher = Thread(target=self.stop_when_idle, daemon=True)
        watcher.start()
        try:
            self.serve_forever()
        finally:
            self.idle_stop.set()
            watcher.join()
            self.server_close()

def load_env():
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

def loopback(address):
    try:
        return ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False

_own_ips = (0.0, frozenset())

def own_ips():
    global _own_ips
    if time.time() - _own_ips[0] < 30 and _own_ips[1]:
        return _own_ips[1]
    ips = {'127.0.0.1', '::1'}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ips.add(info[4][0].split('%')[0])
    except OSError:
        pass
    try:  # primary outbound interface; a UDP connect sends no packets
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(('192.0.2.1', 9))
            ips.add(probe.getsockname()[0])
    except OSError:
        pass
    _own_ips = (time.time(), frozenset(ips))
    return _own_ips[1]

def local_client(address):
    """True for this PC: loopback or one of its own interface addresses (e.g. its LAN IP)."""
    address = (address or '').split('%')[0]
    if address.startswith('::ffff:'):
        address = address[7:]
    return loopback(address) or address in own_ips()

def clean_prefs(data):
    """Validate chart preferences; unknown keys and bad values are rejected, missing ones default."""
    if not isinstance(data, dict):
        raise ValueError('Invalid preferences.')
    colors = dict(DEFAULT_COLORS)
    given = data.get('colors', {})
    if not isinstance(given, dict):
        raise ValueError('Colors must be an object.')
    for key, value in given.items():
        if key not in STREAMS or not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ValueError('Colors must be #rrggbb values for the known indicators.')
        colors[key] = value.lower()
    active = data.get('active', DEFAULT_PREFS['active'])
    if (not isinstance(active, list) or any(not isinstance(a, str) or a not in STREAMS for a in active)
            or len(set(active)) != len(active)):
        raise ValueError('Active indicators must be a list of known, distinct indicators.')
    order = data.get('order', list(STREAMS))
    if (not isinstance(order, list) or any(not isinstance(o, str) or o not in STREAMS for o in order)
            or len(set(order)) != len(order)):
        raise ValueError('Order must be a list of known, distinct indicators.')
    order = order + [s for s in STREAMS if s not in order]  # anything left out keeps its default place at the end
    stage_colors = dict(DEFAULT_STAGE_COLORS)
    given = data.get('stageColors', {})
    if not isinstance(given, dict):
        raise ValueError('Stage colors must be an object.')
    for key, value in given.items():
        if key not in STAGES or not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ValueError('Stage colors must be #rrggbb values for deep, rem, light and awake.')
        stage_colors[key] = value.lower()
    return {'colors': colors, 'active': [a for a in STREAMS if a in active], 'stageColors': stage_colors, 'order': order}

def load_prefs(path=None):
    path = path or PREFS_PATH
    try:
        return clean_prefs(json.loads(Path(path).read_text(encoding='utf-8')))
    except (OSError, ValueError):
        return clean_prefs({})

def save_prefs(prefs, path=None):
    path = Path(path or PREFS_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(handle, 'w', encoding='utf-8') as out:
            json.dump(prefs, out)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise

def valid_host(host):
    try:
        name = urlsplit('http://' + host).hostname
        if name == 'localhost':
            return True
        address = ipaddress.ip_address(name)
        return address.is_private or address.is_loopback or address.is_link_local
    except (ValueError, TypeError):
        return False

class Handler(BaseHTTPRequestHandler):
    def handle_one_request(self):
        tracking = hasattr(self.server, 'begin_request')
        if tracking:
            self.server.begin_request()
        try:
            super().handle_one_request()
        finally:
            if tracking:
                self.server.end_request()

    def log_message(self, fmt, *args):
        pass  # Never log credentials or request bodies.

    def send(self, code, data, content_type='application/json; charset=utf-8'):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global client
        if not valid_host(self.headers.get('Host', '')):
            return self.send(403, {'error': 'Use localhost or the computer’s LAN IP address.'})
        static = {
            '/': ('index.html', 'text/html; charset=utf-8'),
            '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
            '/style.css': ('style.css', 'text/css; charset=utf-8'),
            '/favicon.svg': ('favicon.svg', 'image/svg+xml'),
            '/favicon.ico': ('favicon.ico', 'image/x-icon'),
        }
        if self.path in static:
            filename, mime = static[self.path]
            return self.send(200, (ROOT / 'static' / filename).read_bytes(), mime)
        parsed = urlsplit(self.path)
        if parsed.path == '/api/heartbeat':
            return self.send(200, {'ok': True})
        if parsed.path == '/api/idle':
            return self.send(200, {'minutes': load_idle()['minutes'], 'readonly': not local_client(self.client_address[0])})
        if parsed.path in ('/api/status', '/api/device', '/api/session'):
            with lock:
                if client is None:
                    return self.send(401, {'error': 'Set EIGHT_EMAIL and EIGHT_PASSWORD in .env and restart d8sleep.'})
                try:
                    if parsed.path == '/api/session':
                        query = parse_qs(parsed.query)
                        sides = query.get('side', [])
                        if len(sides) != 1 or sides[0] not in ('left', 'right', 'solo'):
                            return self.send(400, {'error': 'Specify a valid side.'})
                        try:
                            return self.send(200, {'session': client.session_biometrics(sides[0])})
                        except ValueError as exc:
                            return self.send(400, {'error': str(exc)})
                    if parsed.path == '/api/device':
                        return self.send(200, {'device': client.device_status()})
                    return self.send(200, {'sides': client.status(), 'pod_name': client.pod_name, 'readonly': not local_client(self.client_address[0])})
                except ApiError as exc:
                    return self.send(502, {'error': str(exc)})
        if parsed.path == '/api/prefs':
            return self.send(200, {'prefs': load_prefs()})
        self.send(404, {'error': 'Not found.'})

    def do_PUT(self):
        origin = urlsplit(self.headers.get('Origin', ''))
        if not valid_host(self.headers.get('Host', '')) or origin.scheme != 'http' or origin.netloc != self.headers.get('Host') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(403, {'error': 'Request origin is not allowed.'})
        if not local_client(self.client_address[0]):
            return self.send(403, {'error': 'Read-only from other devices. Use d8sleep on the PC it runs on.'})
        path = urlsplit(self.path).path
        if path not in ('/api/prefs', '/api/idle'):
            return self.send(404, {'error': 'Not found.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError('Invalid request size.')
            data = json.loads(self.rfile.read(length))
            prefs = clean_idle(data) if path == '/api/idle' else clean_prefs(data)
            with lock:
                save_prefs(prefs, IDLE_PATH if path == '/api/idle' else None)
            return self.send(200, prefs if path == '/api/idle' else {'prefs': prefs})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send(400, {'error': str(exc)})
        except OSError:
            return self.send(500, {'error': 'Could not save preferences.'})

    def do_POST(self):
        global client
        origin = self.headers.get('Origin', '')
        parsed = urlsplit(origin)
        if not valid_host(self.headers.get('Host', '')) or parsed.scheme != 'http' or parsed.netloc != self.headers.get('Host') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(403, {'error': 'Request origin is not allowed.'})
        if not local_client(self.client_address[0]):
            return self.send(403, {'error': 'Read-only from other devices. Use d8sleep on the PC it runs on.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError('Invalid request size.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Invalid request.')
            with lock:
                if client is None:
                    return self.send(401, {'error': 'Set EIGHT_EMAIL and EIGHT_PASSWORD in .env and restart d8sleep.'})
                if self.path == '/api/level':
                    client.set_level(data.get('side'), data.get('level'))
                elif self.path == '/api/power':
                    client.set_power(data.get('side'), data.get('on'))
                else:
                    return self.send(404, {'error': 'Not found.'})
                return self.send(200, {'sides': client.status(), 'pod_name': client.pod_name, 'readonly': False})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send(400, {'error': str(exc)})
        except ApiError as exc:
            return self.send(502, {'error': str(exc)})

def main():
    global client
    load_env()
    if os.getenv('EIGHT_EMAIL') and os.getenv('EIGHT_PASSWORD'):
        client = EightClient(os.environ['EIGHT_EMAIL'], os.environ['EIGHT_PASSWORD'], archive_dir=ROOT / 'data' / 'sessions')
    port = int(os.getenv('PORT', '8787'))
    print(f'd8sleep: http://localhost:{port} (also available on your home network)')
    IdleServer(('0.0.0.0', port), Handler).serve_until_idle()

if __name__ == '__main__':
    main()
