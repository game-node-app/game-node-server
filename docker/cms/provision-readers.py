"""Provision separate server-only Directus readers using supplied static tokens."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

base = os.environ['CMS_URL'].rstrip('/')

def request(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'{method} {path.split("?")[0]} failed with HTTP {error.code}') from error

accounts = [(name, os.environ[email], os.environ[token]) for name, email, token in [
    ('Blog delivery', 'CMS_DELIVERY_EMAIL', 'BLOG_CMS_DELIVERY_TOKEN'),
    ('Blog preview', 'CMS_PREVIEW_EMAIL', 'BLOG_CMS_PREVIEW_TOKEN'),
]]
if accounts[0][1].lower() == accounts[1][1].lower() or accounts[0][2] == accounts[1][2] or any(len(item[2]) < 32 for item in accounts):
    raise ValueError('Readers require distinct emails and distinct tokens of at least 32 characters')
login = request('POST', '/auth/login', {'email': os.environ['CMS_ADMIN_EMAIL'], 'password': os.environ['CMS_ADMIN_PASSWORD']})
admin = login['data']['access_token']
for name, email, secret in accounts:
    role_query = urllib.parse.urlencode({'filter[name][_eq]': name})
    roles = request('GET', '/roles?' + role_query, token=admin)['data']
    if len(roles) != 1:
        raise RuntimeError('Expected exactly one ' + name + ' role; run setup first')
    role = roles[0]['id']
    users = request('GET', '/users?' + urllib.parse.urlencode({'filter[email][_eq]': email}), token=admin)['data']
    if users:
        if len(users) != 1 or users[0]['role'] != role:
            raise RuntimeError('Reader email belongs to a different role')
        request('PATCH', '/users/' + users[0]['id'], {'token': secret, 'status': 'active'}, admin)
    else:
        request('POST', '/users', {'email': email, 'role': role, 'token': secret, 'status': 'active'}, admin)
    print('Provisioned ' + name)
