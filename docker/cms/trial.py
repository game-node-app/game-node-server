"""Seed the disposable trial and assert private records/assets survive restart."""
import base64
import json
from pathlib import Path
from uuid import UUID
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8055'
settings = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if '=' in line)


def request(method, path, data=None, token=None, content_type='application/json'):
    headers = {'Content-Type': content_type}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if isinstance(data, dict):
        data = json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return response.status, json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else raw
    except urllib.error.HTTPError as error:
        return error.code, None


def login():
    status, body = request('POST', '/auth/login', {'email': settings['ADMIN_EMAIL'], 'password': settings['ADMIN_PASSWORD']})
    assert status == 200, ('login failed', status)
    return body['data']['access_token']


token = login()
status, _ = request('GET', '/collections/cms_trial_articles', token=token)
if status != 200:
    status, _ = request('POST', '/collections', {
        'collection': 'cms_trial_articles', 'schema': {},
        'meta': {'note': 'Disposable editorial trial; not the adopted blog schema'},
        'fields': [
            {'field': 'id', 'type': 'uuid', 'meta': {'special': ['uuid'], 'hidden': True, 'readonly': True}, 'schema': {'is_primary_key': True}},
            {'field': 'locale', 'type': 'string', 'schema': {}},
            {'field': 'status', 'type': 'string', 'meta': {'interface': 'select-dropdown', 'options': {'choices': [{'text': 'Draft', 'value': 'draft'}, {'text': 'Published', 'value': 'published'}]}}, 'schema': {'default_value': 'draft'}},
            {'field': 'title', 'type': 'string', 'schema': {}},
            {'field': 'content', 'type': 'text', 'meta': {'interface': 'input-rich-text-html'}, 'schema': {}},
            {'field': 'rating', 'type': 'float', 'schema': {}},
        ],
    }, token)
    assert status == 200, ('create collection failed', status)

status, _ = request('PATCH', '/fields/cms_trial_articles/id', {
    'meta': {'special': ['uuid'], 'hidden': True, 'readonly': True},
}, token)
assert status == 200, 'automatic ID field configuration failed'

ids = []
for locale, title, state in [('en', 'Trial review', 'published'), ('pt-BR', 'Resenha de teste', 'draft')]:
    status, body = request('POST', '/items/cms_trial_articles', {
        'locale': locale, 'title': title, 'status': state, 'rating': 4.5,
        'content': '<h2>' + title + '</h2><p>GameNode — ação &amp; aventura.</p><ul><li>Test</li></ul>',
    }, token)
    assert status == 200, ('create fixture failed', status)
    UUID(body['data']['id'])
    ids.append(body['data']['id'])

png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAj0lEQVR4nO3PUQkAABDCUDua4/r/jYshgvACbPJRTfECb4Bqihd4A1RTvMAboJriBd4A1RQv8AaopniBN0A1xQu8AaopXuANUE3xAm+AaooXeANUU7zAG6Ca4gXeANUUL/AGqKZ4gTdANcULvAGqKV7gDVBN8QJvgGqKF3gDVFO8wBugmuIF3gDVFC/wBqj26Sjhllg+SVEAAAAASUVORK5CYII=')
boundary = 'gamenode-cms-trial-upload'
payload = ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="trial.png"\r\nContent-Type: image/png\r\n\r\n').encode() + png + ('\r\n--' + boundary + '--\r\n').encode()
status, body = request('POST', '/files', payload, token, 'multipart/form-data; boundary=' + boundary)
assert status == 200, ('upload failed', status)
asset_id = body['data']['id']
assert request('GET', '/assets/' + asset_id + '?key=system-medium-cover', token=token)[0] == 200, 'image thumbnail failed'
status, body = request('PATCH', '/items/cms_trial_articles/' + ids[1], {'title': 'Resenha editada'}, token)
assert status == 200 and body['data']['title'] == 'Resenha editada', 'article save failed'
for path in ['/items/cms_trial_articles', '/items/cms_trial_articles/' + ids[1], '/assets/' + asset_id]:
    assert request('GET', path)[0] in (401, 403), ('anonymous access allowed', path)

subprocess.run(['docker', 'compose', '-f', str(ROOT / 'compose.yml'), 'restart', 'cms'], check=True, capture_output=True)
for attempt in range(60):
    try:
        if request('GET', '/server/ping')[0] == 200:
            break
    except (OSError, TimeoutError):
        pass
    time.sleep(1)
else:
    raise AssertionError('CMS did not restart within 60 seconds')
token = login()
for item_id in ids:
    assert request('GET', '/items/cms_trial_articles/' + item_id, token=token)[0] == 200
assert request('GET', '/assets/' + asset_id, token=token)[1] == png
assert request('GET', '/assets/' + asset_id)[0] in (401, 403)
print('PASS: bilingual fixtures, upload, private records/media and restart persistence')
print('Writer fixtures:', ', '.join(ids))
