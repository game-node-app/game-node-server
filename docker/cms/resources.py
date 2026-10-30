"""Local Directus-only resource measurement against disposable MySQL fixtures."""
from collections import Counter
import concurrent.futures
from datetime import datetime
import http.client
import json
import math
import os
from pathlib import Path
import socket
import statistics
import struct
import subprocess
import threading
import time
import urllib.error
import zlib

ROOT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8056'
CONTAINER = 'gamenode-cms-load-cms-1'
COLLECTION = 'cms_resource_articles'


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=10)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def docker(path):
    connection = DockerConnection()
    try:
        connection.request('GET', '/containers/' + CONTAINER + path)
        response = connection.getresponse()
        assert response.status == 200, response.status
        return json.loads(response.read())
    finally:
        connection.close()


connections = threading.local()


def request(method, path, data=None, token=None, content_type='application/json'):
    headers = {'Content-Type': content_type}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if isinstance(data, (dict, list)):
        data = json.dumps(data).encode()
    if not hasattr(connections, 'http'):
        connections.http = http.client.HTTPConnection('127.0.0.1', 8056, timeout=15)
    connection = connections.http
    try:
        connection.request(method, path, data, headers)
        response = connection.getresponse()
        raw = response.read()
        if response.status >= 400:
            raise urllib.error.HTTPError(BASE + path, response.status, response.reason, response.headers, None)
        return json.loads(raw) if 'application/json' in response.getheader('Content-Type', '') else raw
    except Exception:
        connection.close()
        raise


def percentile(values, percent):
    return sorted(values)[max(0, math.ceil(len(values) * percent) - 1)] if values else None


assert percentile([1, 2, 3, 4, 5], .95) == 5
assert percentile([], .95) is None
settings = dict(line.split('=', 1) for line in (ROOT.parent.parent / '.env').read_text().splitlines() if '=' in line)
token = request('POST', '/auth/login', {'email': settings['CMS_ADMIN_EMAIL'], 'password': settings['CMS_ADMIN_PASSWORD']})['data']['access_token']
try:
    request('GET', '/collections/' + COLLECTION, token=token)
except urllib.error.HTTPError as error:
    if error.code not in (403, 404):
        raise
    request('POST', '/collections', {'collection': COLLECTION, 'schema': {}, 'fields': [
        {'field': 'id', 'type': 'uuid', 'meta': {'special': ['uuid'], 'hidden': True, 'readonly': True}, 'schema': {'is_primary_key': True}},
        {'field': 'status', 'type': 'string', 'schema': {}},
        {'field': 'title', 'type': 'string', 'schema': {}},
        {'field': 'content', 'type': 'text', 'schema': {}},
    ]}, token)
policies = request('GET', '/policies?filter[name][_eq]=$t:public_label', token=token)['data']
assert len(policies) == 1, 'Expected built-in Public policy'
permissions = request('GET', '/permissions?filter[collection][_eq]=' + COLLECTION, token=token)['data']
if not permissions:
    request('POST', '/permissions', {'policy': policies[0]['id'], 'collection': COLLECTION, 'action': 'read', 'fields': ['*'], 'permissions': {}}, token)
rows = request('GET', '/items/' + COLLECTION + '?limit=1', token=token)['data']
if not rows:
    for batch in range(10):
        rows.extend(request('POST', '/items/' + COLLECTION, [{'status': 'published', 'title': 'Resource fixture ' + str(batch * 10 + i), 'content': '<p>GameNode ação e aventura.</p>' * 400} for i in range(10)], token)['data'])
item_id = rows[0]['id']
public = request('GET', '/items/' + COLLECTION + '?aggregate[count]=*')['data']
assert int(public[0]['count']) == 100, public

# Generate a valid photo-sized PNG without image tooling or external fixtures.
def chunk(kind, data):
    return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 1024, 768, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(b'\0' + os.urandom(1024 * 3) for _ in range(768)))) + chunk(b'IEND', b'')
boundary = 'cms-resource-fixture'
payload = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="load.png"\r\nContent-Type: image/png\r\n\r\n').encode() + png + ('\r\n--' + boundary + '--\r\n').encode()
assets = []


def upload():
    asset = request('POST', '/files', payload, token, 'multipart/form-data; boundary=' + boundary)['data']['id']
    assets.append(asset)
    image = request('GET', '/assets/' + asset + '?width=640&height=480&fit=inside', token=token)
    assert len(image) > 0


report = {'scope': 'Directus container only; local MySQL, no application co-load or VPS claims', 'image': 'directus/directus:12.6.0', 'database': 'mysql:8.0', 'limits': {'cpu': 1, 'memory_mib': 1024}, 'upload_bytes': len(png), 'phases': []}


def phase(name, seconds, clients=0, action=None, pause=0):
    started = time.monotonic()
    stop = threading.Event()
    samples, latencies, errors = [], [], Counter()

    def monitor():
        previous = None
        while not stop.is_set():
            try:
                data = docker('/stats?stream=false&one-shot=true')
                now = time.monotonic()
                cpu = data['cpu_stats']['cpu_usage']['total_usage']
                memory = data['memory_stats']
                sample = {'memory_mib': (memory.get('usage', 0) - memory.get('stats', {}).get('inactive_file', 0)) / 1024**2}
                if previous:
                    sample['cpu_percent_one_core'] = (cpu - previous[1]) / 1e9 / (now - previous[0]) * 100
                previous = (now, cpu)
                samples.append(sample)
            except Exception as error:
                errors['monitor: ' + type(error).__name__] += 1
            stop.wait(1)

    def worker():
        while time.monotonic() - started < seconds:
            before = time.monotonic()
            try:
                action()
                latencies.append((time.monotonic() - before) * 1000)
            except Exception as error:
                errors[type(error).__name__ + ': ' + str(error)] += 1
                time.sleep(.05)
            if pause:
                time.sleep(pause)

    monitor_thread = threading.Thread(target=monitor)
    monitor_thread.start()
    if clients:
        with concurrent.futures.ThreadPoolExecutor(max_workers=clients) as pool:
            list(pool.map(lambda _: worker(), range(clients)))
    else:
        time.sleep(seconds)
    stop.set()
    monitor_thread.join()
    elapsed = time.monotonic() - started
    cpu = [s['cpu_percent_one_core'] for s in samples if 'cpu_percent_one_core' in s]
    result = {'name': name, 'elapsed_s': round(elapsed, 2), 'clients': clients, 'successful_operations': len(latencies), 'operations_per_s': round(len(latencies) / elapsed, 2), 'p95_ms': percentile(latencies, .95), 'peak_memory_mib': max((s['memory_mib'] for s in samples), default=None), 'mean_cpu_percent_one_core': statistics.mean(cpu) if cpu else None, 'peak_cpu_percent_one_core': max(cpu, default=None), 'errors': errors, 'samples': len(samples)}
    report['phases'].append(result)
    print(json.dumps(result), flush=True)


before = docker('/json')
logs = subprocess.run(['docker', 'logs', '--timestamps', CONTAINER], capture_output=True, text=True, check=True).stdout
ready_lines = [line for line in logs.splitlines() if 'Server started at ' in line]
assert ready_lines, 'Missing startup evidence'
started_at = datetime.fromisoformat(before['State']['StartedAt'].replace('Z', '+00:00'))
ready_at = datetime.fromisoformat(ready_lines[-1].split(' ', 1)[0].replace('Z', '+00:00'))
report['startup_to_http_ready_s'] = (ready_at - started_at).total_seconds()

phase('idle', 30)
for clients in (1, 5, 10, 20):
    phase('public_reads_' + str(clients), 20, clients, lambda: request('GET', '/items/' + COLLECTION + '?limit=10&fields=id,title,content'))
phase('edit', 20, 1, lambda: request('PATCH', '/items/' + COLLECTION + '/' + item_id, {'title': 'Measured edit ' + str(time.time_ns())}, token), .5)
phase('upload_and_thumbnail', 15, 1, upload, 1)
phase('recovery_idle', 20)
after = docker('/json')
report['cgroup_lifetime_peak_memory_mib'] = int(subprocess.run(['docker', 'exec', CONTAINER, 'cat', '/sys/fs/cgroup/memory.peak'], capture_output=True, text=True, check=True).stdout) / 1024**2
report['oom_killed'] = after['State']['OOMKilled']
report['unexpected_restarts'] = after['RestartCount'] - before['RestartCount']
report['passed_local_limits'] = not report['oom_killed'] and report['unexpected_restarts'] == 0 and all(not p['errors'] and p['peak_memory_mib'] is not None and p['peak_memory_mib'] < 1024 for p in report['phases'])
output = ROOT / 'resources.local.json'
output.write_text(json.dumps(report, indent=2) + '\n')
connections.http.close()
for asset in assets:
    request('DELETE', '/files/' + asset, token=token)
print('Report:', output, flush=True)
assert report['passed_local_limits'], 'Resource check failed; inspect report'
