"""Check CMS delivery and preview roles with disposable accounts."""
import json
import os
import secrets
import urllib.error
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
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

status, body = request('POST', '/auth/login', {'email': os.environ['CMS_ADMIN_EMAIL'], 'password': os.environ['CMS_ADMIN_PASSWORD']})
assert status == 200, 'Admin login failed'
admin = body['data']['access_token']
for name in ['Blog delivery', 'Blog preview']:
    status, body = request('GET', '/roles?filter[name][_eq]=' + name.replace(' ', '%20'), token=admin)
    assert status == 200 and len(body['data']) == 1, 'Role is missing'
    password = secrets.token_urlsafe(24)
    email = 'blog-check-' + secrets.token_hex(8) + '@example.com'
    status, body = request('POST', '/users', {'email': email, 'password': password, 'role': body['data'][0]['id'], 'status': 'active'}, admin)
    assert status == 200, body
    user = body['data']['id']
    try:
        status, body = request('POST', '/auth/login', {'email': email, 'password': password})
        assert status == 200, body
        token = body['data']['access_token']
        for collection in ['blog_articles', 'blog_translations', 'blog_tags', 'blog_article_tags']:
            assert request('GET', '/items/' + collection + '?limit=1', token=token)[0] == 200, (name, collection)
        assert request('POST', '/items/blog_articles', {'profile_user_id': 'must-not-write'}, token)[0] == 403, name
        assert request('GET', '/items/blog_translations?limit=1')[0] in (401, 403)
    finally:
        assert request('DELETE', '/users/' + user, token=admin)[0] == 204
print('PASS: delivery and preview can read blog collections, cannot write, and anonymous CMS access is denied')
