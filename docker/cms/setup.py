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
        request('POST', '/collections', {'collection': name, 'meta': {'hidden': False, 'singleton': False}, 'schema': {}, 'fields': fields}, token)
        print('Created', name)
    else:
        print('Exists', name)
        for item in fields:
            status, _ = request('GET', f"/fields/{name}/{item['field']}", token=token)
            if status != 200:
                request('POST', '/fields/' + name, item, token)


for collection, column, target in [('blog_translations', 'article_id', 'blog_articles'), ('blog_article_tags', 'article_id', 'blog_articles'), ('blog_article_tags', 'tag_id', 'blog_tags'), ('blog_articles', 'cover', 'directus_files')]:
    status, _ = request('GET', f'/relations/{collection}/{column}', token=token)
    if status != 200:
        request('POST', '/relations', {'collection': collection, 'field': column, 'related_collection': target, 'schema': {'on_delete': 'RESTRICT'}}, token)
        print('Related', collection, column)
# blog_article_tags is the article<->tag junction, so both aliases are many-to-many.
for collection, alias, source, column, special, junction in [('blog_articles', 'translations', 'blog_translations', 'article_id', 'o2m', None),
        ('blog_articles', 'tags', 'blog_article_tags', 'article_id', 'm2m', 'tag_id'), ('blog_tags', 'articles', 'blog_article_tags', 'tag_id', 'm2m', 'article_id')]:
    status, _ = request('GET', f'/fields/{collection}/{alias}', token=token)
    if status != 200:
        request('POST', '/fields/' + collection, {'field': alias, 'type': 'alias', 'meta': {'special': [special], 'interface': 'list-' + special}}, token)
    request('PATCH', f'/relations/{source}/{column}', {'meta': {'one_field': alias, 'junction_field': junction}}, token)

# Editor form: labels, instructions and order. Re-applied on every run.
def label(pt, en):
    return [{'language': 'pt-BR', 'translation': pt}, {'language': 'en-US', 'translation': en}]

dividers = {'blog_articles': [('section_article', 'Artigo', 'Article', 'Dados que valem para todos os idiomas.'),
    ('section_review', 'Review (opcional)', 'Review (optional)', 'Preencha jogo e nota SOMENTE se o artigo tiver a tag Review. Em outros artigos, deixe os dois vazios.'),
    ('section_texts', 'Textos por idioma', 'Texts by language', 'Crie um texto para cada idioma (English e Português). O site só mostra o idioma que estiver Publicado.')]}
for collection, items in dividers.items():
    for field_name, pt, en, note in items:
        status, _ = request('GET', f'/fields/{collection}/{field_name}', token=token)
        if status != 200:
            request('POST', '/fields/' + collection, {'field': field_name, 'type': 'alias', 'meta': {'special': ['alias', 'no-data'], 'interface': 'presentation-divider'}}, token)
        request('PATCH', f'/fields/{collection}/{field_name}', {'meta': {'interface': 'presentation-divider', 'options': {'title': pt, 'icon': None}, 'note': note, 'translations': label(pt, en)}}, token)

form = {
    'blog_articles': [
        ('section_article', {'width': 'full'}),
        ('profile_user_id', {'interface': 'blog-game-picker', 'options': {'kind': 'users'}, 'required': True, 'width': 'full', 'translations': label('Autor', 'Author'),
            'note': 'Busque pelo nome de usuário da pessoa no GameNode. Ela aparece como autora no site.'}),
        ('cover', {'interface': 'file-image', 'special': ['file'], 'width': 'full', 'translations': label('Imagem de capa', 'Cover image'),
            'note': 'Obrigatória para publicar. JPEG, PNG ou WebP de até 10 MB. A descrição da capa é escrita em cada idioma, em "Textos por idioma".'}),
        ('tags', {'interface': 'list-m2m', 'width': 'full', 'translations': label('Tags', 'Tags'), 'options': {'template': '{{tag_id.name}}', 'enableSelect': True},
            'note': 'Escolha em "Adicionar existente". Use a tag Review para análises de jogo.'}),
        ('section_review', {'width': 'full'}),
        ('game_id', {'interface': 'blog-game-picker', 'options': {'kind': 'games'}, 'width': 'full', 'translations': label('Jogo analisado', 'Reviewed game'),
            'note': 'Digite o nome e clique no jogo certo.'}),
        ('rating', {'interface': 'input', 'options': {'min': 0, 'max': 5, 'step': 0.5, 'placeholder': 'Ex.: 4.5'}, 'width': 'half', 'translations': label('Nota (0 a 5)', 'Rating (0 to 5)'),
            'note': 'De 0 a 5, pode usar meio ponto.'}),
        ('section_texts', {'width': 'full'}),
        ('translations', {'interface': 'list-o2m', 'width': 'full', 'translations': label('Textos', 'Texts'),
            'options': {'template': '{{locale}} · {{status}} · {{title}}', 'enableSelect': False, 'enableSearchFilter': False}}),
    ],
    'blog_translations': [
        ('article_id', {'hidden': True}),
        ('locale', {'width': 'half', 'required': True, 'options': {'choices': [{'text': 'English', 'value': 'en'}, {'text': 'Português (Brasil)', 'value': 'pt-BR'}]}, 'translations': label('Idioma', 'Language'), 'note': 'Um texto por idioma em cada artigo.'}),
        ('status', {'width': 'half', 'options': {'choices': [{'text': 'Rascunho', 'value': 'draft'}, {'text': 'Publicado', 'value': 'published'}]}, 'translations': label('Situação', 'Status'),
            'note': 'Rascunho fica só aqui. Publicado aparece no site a partir da data de publicação.'}),
        ('title', {'interface': 'input', 'width': 'full', 'translations': label('Título', 'Title')}),
        ('excerpt', {'interface': 'input-multiline', 'width': 'full', 'translations': label('Resumo', 'Excerpt'),
            'note': 'Uma ou duas frases que aparecem na lista de artigos.'}),
        ('content', {'width': 'full', 'translations': label('Texto do artigo', 'Article body'),
            'note': 'Toda imagem inserida no texto precisa de uma descrição (texto alternativo).'}),
        ('cover_alt', {'interface': 'input', 'width': 'full', 'translations': label('Descrição da capa', 'Cover description'),
            'note': 'Descreva a imagem de capa para quem não consegue vê-la. Ex.: "Link segurando a Master Sword".'}),
        ('published_at', {'interface': 'datetime', 'width': 'half', 'translations': label('Data de publicação', 'Publish date'),
            'note': 'Obrigatória para publicar. Uma data futura agenda a publicação.'}),
    ],
    'blog_tags': [
        ('id', {'width': 'half', 'translations': label('Código', 'Code'), 'note': 'Minúsculas, sem espaços. Ex.: review. Não pode ser alterado depois.'}),
        ('name', {'width': 'half', 'translations': label('Nome', 'Name')}),
    ],
}
for collection, fields in form.items():
    for sort, (field_name, meta) in enumerate(fields, 1):
        request('PATCH', f'/fields/{collection}/{field_name}', {'meta': {**meta, 'sort': sort}}, token)
for collection, meta in {
    'blog_articles': {'icon': 'article', 'display_template': '{{translations.title}}', 'translations': [{'language': 'pt-BR', 'translation': 'Artigos', 'singular': 'Artigo', 'plural': 'Artigos'}]},
    'blog_translations': {'hidden': True, 'translations': [{'language': 'pt-BR', 'translation': 'Textos', 'singular': 'Texto', 'plural': 'Textos'}], 'display_template': '{{locale}} · {{title}}'},
    'blog_tags': {'icon': 'sell', 'display_template': '{{name}}', 'translations': [{'language': 'pt-BR', 'translation': 'Tags', 'singular': 'Tag', 'plural': 'Tags'}]},
    'blog_article_tags': {'hidden': True},
}.items():
    request('PATCH', '/collections/' + collection, {'meta': meta}, token)
if request('GET', '/items/blog_tags/review', token=token)[0] != 200:
    request('POST', '/items/blog_tags', {'id': 'review', 'name': 'Review'}, token)
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
            live = {'_and': [{'status': {'_eq': 'published'}}, {'published_at': {'_lte': '$NOW'}}]}
            published = {'translations': live}
            filters = {'blog_translations': live, 'blog_articles': published,
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
