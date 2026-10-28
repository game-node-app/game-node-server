"""Create the Directus blog collections; run against a dedicated CMS database."""
import json
import os
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
        if error.code == 404 or (method == 'GET' and error.code == 403):
            return error.code, None
        raise RuntimeError(f'{method} {path}: {error.code} {error.read().decode()}') from error

_, login = request('POST', '/auth/login', {'email': os.environ['CMS_ADMIN_EMAIL'], 'password': os.environ['CMS_ADMIN_PASSWORD']})
token = login['data']['access_token']

def field(name, kind, schema=None, meta=None):
    return {'field': name, 'type': kind, 'schema': schema or {}, 'meta': meta or {}}

def uuid():
    return field('id', 'uuid', {'is_primary_key': True}, {'special': ['uuid'], 'hidden': True, 'readonly': True})

collections = {
    'blog_articles': [uuid(), field('profile_user_id', 'string'), field('cover', 'uuid'), field('game_id', 'string'), field('rating', 'float'),
        field('pending_cover_key', 'string', meta={'hidden': True, 'readonly': True}), field('pending_cover_name', 'string', meta={'hidden': True, 'readonly': True})],
    'blog_tags': [field('id', 'string', {'is_primary_key': True}), field('name', 'string')],
    'blog_translations': [uuid(), field('article_id', 'uuid', {'is_nullable': False}),
        field('locale', 'string', {'is_nullable': False}, {'interface': 'select-dropdown', 'options': {'choices': [{'text': 'English', 'value': 'en'}, {'text': 'Português', 'value': 'pt-BR'}]}}),
        field('status', 'string', {'default_value': 'draft', 'is_nullable': False}, {'interface': 'select-dropdown', 'options': {'choices': [{'text': 'Draft', 'value': 'draft'}, {'text': 'Published', 'value': 'published'}]}}),
        field('title', 'string'), field('content', 'text', meta={'interface': 'input-rich-text-html'}), field('excerpt', 'text'), field('cover_alt', 'string'), field('published_at', 'timestamp'),
        field('media_map', 'json', meta={'hidden': True, 'readonly': True})],
    'blog_article_tags': [field('id', 'integer', {'is_primary_key': True, 'has_auto_increment': True}), field('article_id', 'uuid', {'is_nullable': False}), field('tag_id', 'string', {'is_nullable': False})],
}
for name, fields in collections.items():
    status, _ = request('GET', '/collections/' + name, token=token)
    if status != 200:
        request('POST', '/collections', {'collection': name, 'schema': {}, 'fields': fields}, token)
        print('Created', name)
    else:
        print('Exists', name)
        for item in fields:
            status, _ = request('GET', f"/fields/{name}/{item['field']}", token=token)
            if status != 200:
                request('POST', '/fields/' + name, item, token)

request('PATCH', '/fields/blog_articles/game_id', {'meta': {'interface': 'blog-game-picker'}}, token)

for collection, column, target in [('blog_translations', 'article_id', 'blog_articles'), ('blog_article_tags', 'article_id', 'blog_articles'), ('blog_article_tags', 'tag_id', 'blog_tags'), ('blog_articles', 'cover', 'directus_files')]:
    status, _ = request('GET', f'/relations/{collection}/{column}', token=token)
    if status != 200:
        request('POST', '/relations', {'collection': collection, 'field': column, 'related_collection': target, 'schema': {'on_delete': 'RESTRICT'}}, token)
        print('Related', collection, column)
for collection, alias, source, column in [('blog_articles', 'translations', 'blog_translations', 'article_id'), ('blog_tags', 'articles', 'blog_article_tags', 'tag_id')]:
    status, _ = request('GET', f'/fields/{collection}/{alias}', token=token)
    if status != 200:
        request('POST', '/fields/' + collection, {'field': alias, 'type': 'alias', 'meta': {'special': ['o2m'], 'interface': 'list-o2m'}}, token)
    request('PATCH', f'/relations/{source}/{column}', {'meta': {'one_field': alias}}, token)
def configure_role(name, app_access, actions):
    query_name = name.replace(' ', '%20')
    _, policies = request('GET', '/policies?filter[name][_eq]=' + query_name, token=token)
    if not policies['data']:
        _, result = request('POST', '/policies', {'name': name, 'app_access': app_access, 'admin_access': False}, token)
        policy = result['data']['id']
    else:
        policy = policies['data'][0]['id']
    _, roles = request('GET', '/roles?filter[name][_eq]=' + query_name, token=token)
    if not roles['data']:
        _, result = request('POST', '/roles', {'name': name}, token)
        role = result['data']['id']
    else:
        role = roles['data'][0]['id']
    _, access = request('GET', '/access?filter[role][_eq]=' + role + '&filter[policy][_eq]=' + policy, token=token)
    if not access['data']:
        request('POST', '/access', {'role': role, 'policy': policy}, token)
    _, existing = request('GET', '/permissions?filter[policy][_eq]=' + policy, token=token)
    grants = {(entry['collection'], entry['action']): entry['id'] for entry in existing['data']}
    for collection in collections:
        for action in actions:
            published = {'translations': {'status': {'_eq': 'published'}}}
            filters = {'blog_translations': {'status': {'_eq': 'published'}}, 'blog_articles': published,
                'blog_article_tags': {'article_id': published}, 'blog_tags': {'articles': {'article_id': published}}}
            permissions = filters[collection] if name == 'Blog delivery' else {}
            grant = grants.get((collection, action))
            if grant:
                request('PATCH', '/permissions/' + str(grant), {'fields': ['*'], 'permissions': permissions}, token)
            else:
                request('POST', '/permissions', {'policy': policy, 'collection': collection, 'action': action, 'fields': ['*'], 'permissions': permissions}, token)
    if name in ('Blog editor', 'Blog preview'):
        for action in (actions if name == 'Blog editor' else ['read']):
            if ('directus_files', action) not in grants:
                request('POST', '/permissions', {'policy': policy, 'collection': 'directus_files', 'action': action, 'fields': ['*'], 'permissions': {}}, token)

configure_role('Blog editor', True, ['create', 'read', 'update', 'delete'])
configure_role('Blog delivery', False, ['read'])
configure_role('Blog preview', False, ['read'])
print('Configured blog editor, delivery and preview collection permissions')
print('Apply docker/cms/model-constraints.sql to the dedicated MySQL database before use.')
