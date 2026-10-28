"""Exercise publication hooks against a disposable CMS and local reference API."""
import hashlib
import json
import os
import secrets
import subprocess
import struct
import threading
import time
import urllib.error
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

base = os.environ['CMS_URL'].rstrip('/')
state = {'unavailable': False}

class Reference(BaseHTTPRequestHandler):
    def answer(self):
        status = 503 if state['unavailable'] else 200 if self.path in ('/v1/profile/valid-author', '/v1/game/repository/123', '/v1/search/games') else 404
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b'{"data":{"items":[{"id":123,"name":"Test game"}]}}' if self.path == '/v1/search/games' else b'{}')
    do_GET = answer
    do_POST = answer
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('0.0.0.0', 18081), Reference)
threading.Thread(target=server.serve_forever, daemon=True).start()

def request(method, path, body=None, token=None, content_type='application/json'):
    headers = {'Content-Type': content_type}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    try:
        with urllib.request.urlopen(urllib.request.Request(base + path, data=data, headers=headers, method=method), timeout=15) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

status, body = request('POST', '/auth/login', {'email': os.environ['CMS_ADMIN_EMAIL'], 'password': os.environ['CMS_ADMIN_PASSWORD']})
assert status == 200, body
admin = body['data']['access_token']
assert request('GET', '/blog-game-search?q=test')[0] == 403
status, body = request('GET', '/blog-game-search?q=test', token=admin)
assert status == 200 and body['data'] == [{'id': 123, 'name': 'Test game'}], body
for role_name, expected in [('Blog editor', 200), ('Blog delivery', 403)]:
    status, body = request('GET', '/roles?filter[name][_eq]=' + role_name.replace(' ', '%20'), token=admin)
    assert status == 200 and len(body['data']) == 1
    secret = secrets.token_urlsafe(32)
    status, body = request('POST', '/users', {'email': secrets.token_hex(16) + '@example.com', 'role': body['data'][0]['id'], 'token': secret, 'status': 'active'}, admin)
    assert status == 200, body
    user = body['data']['id']
    try:
        assert request('GET', '/blog-game-search?q=test', token=secret)[0] == expected
    finally:
        assert request('DELETE', '/users/' + user, token=admin)[0] == 204
state['unavailable'] = True
assert request('GET', '/blog-game-search?q=test', token=admin)[0] == 503
state['unavailable'] = False
items = []
try:
    def chunk(name, data):
        return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data))
    def new_png():
        pixels = b''.join(b'\0' + secrets.token_bytes(48) for _ in range(16))
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', 16, 16, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
    boundary = 'blog-publication-check'
    def upload_data():
        return ('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n').encode() + new_png() + ('\r\n--' + boundary + '--\r\n').encode()
    data = upload_data()
    status, body = request('POST', '/files', data, admin, 'multipart/form-data; boundary=' + boundary)
    assert status == 200, body
    cover = body['data']['id']
    items.append(('files', cover))
    def asset_name(query, asset=cover):
        req = urllib.request.Request(base + '/assets/' + asset + '?' + query, headers={'Authorization': 'Bearer ' + admin})
        with urllib.request.urlopen(req, timeout=15) as response:
            return hashlib.sha256(response.read()).hexdigest() + '.webp'
    public_name = asset_name('format=webp')
    inline_name = asset_name('format=webp&height=1&width=1')
    def public_exists(name):
        return subprocess.run(['docker', 'exec', os.environ.get('CMS_CONTAINER', 'gamenode-cms-load-cms-1'), 'test', '-f', '/directus/public-media/' + name], capture_output=True).returncode == 0
    assert not public_exists(public_name) and not public_exists(inline_name)
    assert request('GET', '/assets/' + cover)[0] in (401, 403)
    status, body = request('POST', '/items/blog_articles', {'profile_user_id': 'valid-author', 'cover': cover}, admin)
    assert status == 200, body
    article = body['data']['id']
    items.append(('items/blog_articles', article))
    draft = {'article_id': article, 'locale': 'en', 'status': 'draft', 'title': 'Title', 'content': f'<p>Body</p><img src="/assets/{cover}?width=1&amp;height=1" alt="Cover">', 'excerpt': 'Excerpt', 'cover_alt': 'Cover', 'published_at': '2026-01-01T00:00:00Z'}
    status, body = request('POST', '/items/blog_translations', draft, admin)
    assert status == 200, body
    translation = body['data']['id']
    items.append(('items/blog_translations', translation))
    status, body = request('POST', '/items/blog_translations', {**draft, 'locale': 'pt-BR', 'title': 'Rascunho'}, admin)
    assert status == 200, body
    portuguese = body['data']['id']
    items.append(('items/blog_translations', portuguese))
    status, body = request('POST', '/items/blog_translations', draft, admin)
    assert status == 400 and body['errors'][0]['extensions']['code'] == 'RECORD_NOT_UNIQUE', body
    path = '/items/blog_translations/' + translation
    state['unavailable'] = True
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 400
    assert not public_exists(public_name) and not public_exists(inline_name)
    state['unavailable'] = False
    assert request('PATCH', '/items/blog_articles/' + article, {'profile_user_id': 'unknown'}, admin)[0] == 200
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 400
    assert request('PATCH', '/items/blog_articles/' + article, {'profile_user_id': 'valid-author'}, admin)[0] == 200
    assert request('PATCH', path, {'content': '<img src="x">', 'status': 'published'}, admin)[0] == 400
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 200
    for _ in range(50):
        if public_exists(public_name) and public_exists(inline_name): break
        time.sleep(.1)
    assert public_exists(public_name) and public_exists(inline_name), 'Published media was not copied into public storage'
    status, body = request('POST', '/items/blog_articles', {'profile_user_id': 'draft-only'}, admin)
    assert status == 200, body
    draft_article = body['data']['id']
    items.append(('items/blog_articles', draft_article))
    status, body = request('POST', '/items/blog_translations', {'article_id': draft_article, 'locale': 'en', 'status': 'draft'}, admin)
    assert status == 200, body
    items.append(('items/blog_translations', body['data']['id']))
    tags = []
    for parent in (article, draft_article):
        tag = 'check-' + secrets.token_hex(8)
        status, body = request('POST', '/items/blog_tags', {'id': tag, 'name': tag}, admin)
        assert status == 200, body
        items.append(('items/blog_tags', tag))
        status, body = request('POST', '/items/blog_article_tags', {'article_id': parent, 'tag_id': tag}, admin)
        assert status == 200, body
        items.append(('items/blog_article_tags', str(body['data']['id'])))
        tags.append(tag)
    for role_name in ['Blog delivery', 'Blog preview']:
        status, body = request('GET', '/roles?filter[name][_eq]=' + role_name.replace(' ', '%20'), token=admin)
        assert status == 200 and len(body['data']) == 1
        secret = secrets.token_urlsafe(32)
        status, body = request('POST', '/users', {'email': secrets.token_hex(16) + '@example.com', 'role': body['data'][0]['id'], 'token': secret, 'status': 'active'}, admin)
        assert status == 200, body
        user = body['data']['id']
        try:
            status, body = request('GET', '/items/blog_translations?filter[article_id][_eq]=' + article, token=secret)
            assert status == 200 and {row['locale'] for row in body['data']} == ({'en'} if role_name == 'Blog delivery' else {'en', 'pt-BR'}), body
            status, body = request('GET', '/items/blog_articles/' + article + '?fields=id,translations.locale', token=secret)
            assert status == 200 and {row['locale'] for row in body['data']['translations']} == ({'en'} if role_name == 'Blog delivery' else {'en', 'pt-BR'}), body
            status, _ = request('GET', '/items/blog_translations/' + portuguese, token=secret)
            assert status == (403 if role_name == 'Blog delivery' else 200)
            assert request('PATCH', path, {'title': 'must not write'}, secret)[0] == 403
            try:
                asset_request = urllib.request.Request(base + '/assets/' + cover, headers={'Authorization': 'Bearer ' + secret})
                with urllib.request.urlopen(asset_request, timeout=15) as response:
                    asset_status = response.status
            except urllib.error.HTTPError as error:
                asset_status = error.code
            assert asset_status == (403 if role_name == 'Blog delivery' else 200), (role_name, asset_status)
            for collection, visible, hidden in [('blog_articles', article, draft_article), ('blog_tags', tags[0], tags[1])]:
                assert request('GET', '/items/' + collection + '/' + visible, token=secret)[0] == 200
                result = request('GET', '/items/' + collection + '/' + hidden, token=secret)[0]
                assert result == (403 if role_name == 'Blog delivery' else 200), (collection, role_name, result)
        finally:
            assert request('DELETE', '/users/' + user, token=admin)[0] == 204
    assert request('GET', '/items/blog_translations/' + portuguese)[0] in (401, 403)
    cover_key = hashlib.sha256((cover + '?format=webp').encode()).hexdigest() + '.webp'
    assert request('GET', path, token=admin)[1]['data']['media_map'][cover_key] == public_name
    if os.environ.get('CMS_TEST_DELIVERY') == '1':
        env = os.environ.copy()
        env['CMS_TEST_ARTICLE_ID'] = article
        env['CMS_TEST_MEDIA_NAMES'] = json.dumps([public_name, inline_name])
        result = subprocess.run(['yarn', 'ts-node', 'docker/cms/check-delivery.ts'], env=env, text=True, capture_output=True, timeout=60)
        assert result.returncode == 0, result.stderr
        assert 'PASS: real CMS published fallback, cover and inline media through the public API' in result.stdout
        print('PASS: real CMS published fallback, cover and inline media through the public API')
    status, body = request('PATCH', '/files/' + cover, upload_data(), admin, 'multipart/form-data; boundary=' + boundary)
    assert status == 200, body
    updated_name = asset_name('format=webp')
    assert updated_name != public_name and not public_exists(updated_name)
    assert request('PATCH', path, {'content': '<img src="/assets/' + cover + '" />'}, admin)[0] == 400
    assert not public_exists(updated_name)
    assert request('GET', path, token=admin)[1]['data']['media_map'][cover_key] == public_name
    assert request('PATCH', path, {'title': 'Updated title'}, admin)[0] == 200
    for _ in range(50):
        if public_exists(updated_name): break
        time.sleep(.1)
    assert public_exists(updated_name) and public_exists(public_name)
    assert request('GET', path, token=admin)[1]['data']['media_map'][cover_key] == updated_name
    status, body = request('POST', '/files', upload_data(), admin, 'multipart/form-data; boundary=' + boundary)
    assert status == 200, body
    replacement = body['data']['id']
    items.insert(0, ('files', replacement))
    replacement_name = asset_name('format=webp', replacement)
    assert not public_exists(replacement_name)
    state['unavailable'] = True
    assert request('PATCH', '/items/blog_articles/' + article, {'cover': replacement}, admin)[0] == 400
    assert not public_exists(replacement_name)
    state['unavailable'] = False
    assert request('PATCH', '/items/blog_articles/' + article, {'cover': replacement}, admin)[0] == 200
    replacement_key = hashlib.sha256((replacement + '?format=webp').encode()).hexdigest() + '.webp'
    for _ in range(50):
        if public_exists(replacement_name) and request('GET', path, token=admin)[1]['data']['media_map'].get(replacement_key) == replacement_name: break
        time.sleep(.1)
    assert public_exists(replacement_name)
    assert request('GET', path, token=admin)[1]['data']['media_map'][replacement_key] == replacement_name
    state['unavailable'] = True
    assert request('PATCH', '/items/blog_articles/' + article, {'profile_user_id': 'valid-author'}, admin)[0] == 400
    state['unavailable'] = False
    assert request('PATCH', '/items/blog_articles/' + article, {'profile_user_id': 'unknown'}, admin)[0] == 400
    assert request('PATCH', '/items/blog_articles/' + article, {'game_id': '123', 'rating': 4}, admin)[0] == 400
    assert request('GET', path, token=admin)[1]['data']['status'] == 'published'
    assert request('PATCH', path, {'status': 'draft'}, admin)[0] == 200
    assert public_exists(public_name) and public_exists(inline_name)
    status, body = request('POST', '/items/blog_tags', {'id': 'review', 'name': 'Review'}, admin)
    created_tag = status == 200
    if created_tag: items.insert(0, ('items/blog_tags', 'review'))
    assert request('PATCH', '/items/blog_articles/' + article, {'game_id': 'unknown', 'rating': 6}, admin)[0] == 200
    status, body = request('POST', '/items/blog_article_tags', {'article_id': article, 'tag_id': 'review'}, admin)
    assert status == 200, body
    items.append(('items/blog_article_tags', str(body['data']['id'])))
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 400
    assert request('PATCH', '/items/blog_articles/' + article, {'rating': 4}, admin)[0] == 200
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 400
    assert request('PATCH', '/items/blog_articles/' + article, {'game_id': '123'}, admin)[0] == 200
    assert request('PATCH', path, {'status': 'published'}, admin)[0] == 200
    assert request('DELETE', '/items/blog_article_tags/' + items[-1][1], token=admin)[0] == 400
    assert request('GET', path, token=admin)[1]['data']['title'] == 'Updated title'
    assert request('PATCH', path, {'status': 'draft'}, admin)[0] == 200
    print('PASS: publication validation, shared edits, references and draft preservation')
finally:
    for collection, item in items:
        if collection == 'items/blog_translations':
            request('PATCH', '/' + collection + '/' + item, {'status': 'draft'}, admin)
    for collection, item in reversed(items):
        status, _ = request('DELETE', '/' + collection + '/' + item, token=admin)
        assert status == 204, (collection, status)
    server.shutdown()
