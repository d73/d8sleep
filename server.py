import ipaddress
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit, parse_qs
from eight import EightClient, ApiError

ROOT = Path(__file__).resolve().parent
lock = RLock()
client = None

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
        if self.path in ('/', '/app.js', '/style.css'):
            filename = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'}[self.path]
            mime = {'index.html':'text/html', 'app.js':'text/javascript', 'style.css':'text/css'}[filename]
            return self.send(200, (ROOT / 'static' / filename).read_bytes(), mime + '; charset=utf-8')
        parsed = urlsplit(self.path)
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
                    return self.send(200, {'sides': client.status(), 'pod_name': client.pod_name})
                except ApiError as exc:
                    return self.send(502, {'error': str(exc)})
        self.send(404, {'error': 'Not found.'})

    def do_POST(self):
        global client
        origin = self.headers.get('Origin', '')
        parsed = urlsplit(origin)
        if not valid_host(self.headers.get('Host', '')) or parsed.scheme != 'http' or parsed.netloc != self.headers.get('Host') or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(403, {'error': 'Request origin is not allowed.'})
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
                return self.send(200, {'sides': client.status(), 'pod_name': client.pod_name})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send(400, {'error': str(exc)})
        except ApiError as exc:
            return self.send(502, {'error': str(exc)})

def main():
    global client
    load_env()
    if os.getenv('EIGHT_EMAIL') and os.getenv('EIGHT_PASSWORD'):
        client = EightClient(os.environ['EIGHT_EMAIL'], os.environ['EIGHT_PASSWORD'])
    port = int(os.getenv('PORT', '8787'))
    print(f'd8sleep: http://localhost:{port} (also available on your home network)')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()

if __name__ == '__main__':
    main()
