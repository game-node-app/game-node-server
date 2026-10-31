import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../../auth/auth.service';
import { UserInitService } from '../../user/user-init/user-init.service';
import { BlogCmsService } from './blog-cms.service';
import { BlogDeliveryService } from './blog-delivery.service';
import { BlogPresentationService } from './blog-presentation.service';
import { BlogPostController } from './blog-post.controller';
import { BlogPreviewController } from './blog-preview.controller';
import { BlogMediaController } from './blog-media.controller';

const { mediaReference } = require('./blog-media.cjs');
const cover = 'abc12345-0000-4000-8000-0123456789ab';
const coverName = 'a'.repeat(64) + '.webp';
const inlineName = 'b'.repeat(64) + '.webp';
const fixture = (locale: string, status: string, article_id = 'article') => ({ id: article_id + locale, article_id, locale, status, title: locale, content: `<p onclick="bad()">Body<script>bad()</script></p><a href="javascript:bad()">bad</a><a href="https://example.com">good</a><img src="/assets/${cover}?width=1" alt="Image">`, excerpt: 'Excerpt', cover_alt: 'Cover', published_at: '2025-01-01', media_map: {
    [mediaReference('/assets/' + cover, 'https://cms.example').name]: coverName,
    [mediaReference('/assets/' + cover + '?width=1', 'https://cms.example').name]: inlineName,
} });

@Module({ imports: [HttpModule, ConfigModule.forRoot()], controllers: [BlogPostController, BlogPreviewController, BlogMediaController], providers: [BlogCmsService, BlogDeliveryService, BlogPresentationService, AuthService, { provide: UserInitService, useValue: { init: async () => undefined } }] })
class BlogTestModule {}

describe('blog HTTP delivery and access', () => {
    let app: INestApplication;
    let cms: Server;
    let directory: string;
    const users: string[] = [];
    let editor: string;
    let reader: string;
    let cmsMode: 'normal' | 'fail' | 'empty' = 'normal';
    beforeAll(async () => {
        cms = createServer((req, res) => {
            const preview = req.headers.authorization === 'Bearer preview-token';
            if (!preview && req.headers.authorization !== 'Bearer delivery-token') { res.writeHead(403).end(); return; }
            if (cmsMode === 'fail') { res.writeHead(500).end(); return; }
            if (req.url?.startsWith('/assets/')) { res.setHeader('Content-Type', 'image/webp'); res.end('image'); return; }
            const rows: Record<string, unknown[]> = {
                blog_articles: [{ id: 'article', profile_user_id: 'author', cover, game_id: '42', rating: 4 }, { id: 'hidden', profile_user_id: 'author', cover, game_id: null, rating: null }, { id: 'localized', profile_user_id: 'author', cover, game_id: null, rating: null }],
                blog_translations: [fixture('en', 'published'), fixture('pt-BR', 'draft'), fixture('pt-BR', 'draft', 'hidden'), fixture('en', 'published', 'localized'), fixture('pt-BR', 'published', 'localized')],
                blog_tags: [{ id: 'review', name: 'Review' }, { id: 'hidden', name: 'Hidden' }, { id: 'news', name: 'News' }], blog_article_tags: [{ id: 1, article_id: 'article', tag_id: 'review' }, { id: 2, article_id: 'hidden', tag_id: 'hidden' }, { id: 3, article_id: 'localized', tag_id: 'news' }],
            };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: cmsMode === 'empty' ? [] : rows[new URL(req.url!, 'http://localhost').pathname.split('/').pop()!] ?? [] }));
        });
        await new Promise<void>((resolve) => cms.listen(0, '127.0.0.1', resolve));
        directory = await mkdtemp(join(tmpdir(), 'blog-http-'));
        process.env.BLOG_CMS_URL = `http://127.0.0.1:${(cms.address() as AddressInfo).port}`;
        process.env.BLOG_CMS_PUBLIC_URL = process.env.BLOG_CMS_URL;
        process.env.BLOG_CMS_DELIVERY_TOKEN = 'delivery-token';
        process.env.BLOG_CMS_PREVIEW_TOKEN = 'preview-token';
        process.env.BLOG_PUBLIC_MEDIA_PATH = directory;
        process.env.DOMAIN_API = 'http://localhost:5000';
        await writeFile(join(directory, coverName), 'image');
        await writeFile(join(directory, inlineName), 'image');
        const module = await Test.createTestingModule({ imports: [BlogTestModule] }).compile();
        app = module.createNestApplication();
        const auth = await module.get(AuthService).auth.$context;
        async function session(role?: string) {
            const user = await auth.internalAdapter.createUser({ email: `${randomUUID()}@example.test`, name: 'Blog test', emailVerified: true, ...(role && { role }) }, { method: 'test' });
            users.push(user.id);
            return (await auth.internalAdapter.createSession(user.id)).token;
        }
        editor = await session('user,editor');
        reader = await session();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
        await app.init();
    });
    afterAll(async () => {
        if (app) {
            const auth = await app.get(AuthService).auth.$context;
            for (const id of users) await auth.internalAdapter.deleteUser(id);
            await app.close();
        }
        if (cms) await new Promise<void>((resolve, reject) => cms.close((error) => error ? reject(error) : resolve()));
        if (directory) await rm(directory, { recursive: true, force: true });
        for (const key of ['BLOG_CMS_URL', 'BLOG_CMS_PUBLIC_URL', 'BLOG_CMS_DELIVERY_TOKEN', 'BLOG_CMS_PREVIEW_TOKEN', 'BLOG_PUBLIC_MEDIA_PATH', 'DOMAIN_API']) delete process.env[key];
    });
    it('returns published fallback and validates locale even for an editor', async () => {
        const result = await request(app.getHttpServer()).get('/v1/blog/post/article?locale=pt-BR').set('Authorization', `Bearer ${editor}`).expect(200);
        expect(result.body).toMatchObject({ title: 'en', profileUserId: 'author', requestedLocale: 'pt-BR', resolvedLocale: 'en', availableLocales: ['en'], review: { gameId: 42, rating: 4 } });
        expect(result.body.content).toContain('/v1/blog/media/');
        expect(result.body.content).not.toMatch(/script|onclick|javascript:|\/assets\//);
        expect(result.body.content).toContain('href="https://example.com"');
        expect(result.body).not.toHaveProperty('status');
        await request(app.getHttpServer()).get('/v1/blog/post?locale=invalid').expect(400);
        const list = await request(app.getHttpServer()).get('/v1/blog/post?tag=review').expect(200);
        expect(list.body.pagination.totalItems).toBe(1);
        expect((await request(app.getHttpServer()).get('/v1/blog/post/localized?locale=pt-BR').expect(200)).body).toMatchObject({ title: 'pt-BR', resolvedLocale: 'pt-BR', availableLocales: ['en', 'pt-BR'] });
        expect((await request(app.getHttpServer()).get('/v1/blog/post/localized').expect(200)).body).toMatchObject({ title: 'en', requestedLocale: 'en' });
        await request(app.getHttpServer()).get('/v1/blog/post/hidden?locale=pt-BR').expect(404);
        expect((await request(app.getHttpServer()).get('/v1/blog/post/tags?locale=pt-BR').expect(200)).body).toEqual([{ id: 'news', name: 'News' }, { id: 'review', name: 'Review' }]);
    });
    it('restricts exact-locale draft preview to editorial roles', async () => {
        await request(app.getHttpServer()).get('/v1/blog/preview/article?locale=pt-BR').expect(401);
        await request(app.getHttpServer()).get('/v1/blog/preview/article?locale=pt-BR').set('Authorization', `Bearer ${reader}`).expect(403);
        const result = await request(app.getHttpServer()).get('/v1/blog/preview/article?locale=pt-BR').set('Authorization', `Bearer ${editor}`).expect(200);
        expect(result.headers['cache-control']).toBe('private, no-store');
        expect(result.body).toMatchObject({ title: 'pt-BR', status: 'draft', resolvedLocale: 'pt-BR' });
        expect(result.body.content).not.toMatch(/script|onclick|javascript:/);
        expect(result.body.content).toContain('href="https://example.com"');
        await request(app.getHttpServer()).get(`/v1/blog/preview/media/${cover}`).expect(401);
        await request(app.getHttpServer()).get(`/v1/blog/preview/media/${cover}`).set('Authorization', `Bearer ${reader}`).expect(403);
        const image = await request(app.getHttpServer()).get(`/v1/blog/preview/media/${cover}?width=1`).set('Authorization', `Bearer ${editor}`).expect(200);
        expect(image.headers['cache-control']).toBe('private, no-store');
        expect(image.headers['content-type']).toMatch(/^image\/webp/);
        await request(app.getHttpServer()).get('/v1/blog/preview/article').set('Authorization', `Bearer ${editor}`).expect(400);
        await request(app.getHttpServer()).get('/v1/blog/preview/hidden?locale=en').set('Authorization', `Bearer ${editor}`).expect(404);
    });
    it('distinguishes CMS failure, missing articles and a successful empty archive', async () => {
        cmsMode = 'fail';
        await request(app.getHttpServer()).get('/v1/blog/post').expect(503);
        cmsMode = 'empty';
        await request(app.getHttpServer()).get('/v1/blog/post/article').expect(404);
        const result = await request(app.getHttpServer()).get('/v1/blog/post').expect(200);
        expect(result.body.data).toEqual([]);
        expect(result.body.pagination.totalItems).toBe(0);
        cmsMode = 'normal';
    });
    it('publishes read-only blog routes in OpenAPI', () => {
        const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test').setVersion('1').build());
        expect(Object.keys(document.paths['/v1/blog/post'] ?? {})).toEqual(['get']);
        expect(Object.keys(document.paths['/v1/blog/post/{postId}'] ?? {})).toEqual(['get']);
        expect(document.paths['/v1/blog/post/{postId}/image']).toBeUndefined();
        expect(document.paths['/v1/blog/preview/{postId}']?.get).toBeDefined();
        const params = document.paths['/v1/blog/post']!.get!.parameters as Array<{ name: string; schema: { type: string } }>;
        expect(params.find((param) => param.name === 'limit')?.schema.type).toBe('number');
        expect(params.find((param) => param.name === 'offset')?.schema.type).toBe('number');
    });
});
