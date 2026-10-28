import { HttpService } from '@nestjs/axios';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { BlogCmsService } from './blog-cms.service';
import { BlogDeliveryService } from './blog-delivery.service';

describe('blog CMS reads', () => {
    let server: Server;
    let service: BlogCmsService;
    beforeEach(async () => {
        server = createServer((req, res) => {
            if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(403).end(); return; }
            const url = new URL(req.url!, 'http://localhost');
            const rows: Record<string, unknown[]> = {
                blog_articles: [{ id: 'a', profile_user_id: 'author', cover: 'cover', game_id: null, rating: null }],
                blog_translations: [{ id: 't', article_id: 'a', locale: 'en', status: 'published', title: 'Title', content: '<p>Text</p>', excerpt: 'Excerpt', cover_alt: 'Cover', published_at: '2025-01-01' }],
                blog_tags: [{ id: 'news', name: 'News' }],
                blog_article_tags: [{ id: 1, article_id: 'a', tag_id: 'news' }],
            };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: rows[url.pathname.split('/').pop()!] ?? [] }));
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        process.env.BLOG_CMS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        process.env.BLOG_CMS_DELIVERY_TOKEN = 'test-token';
        service = new BlogCmsService(new HttpService());
    });
    afterEach(async () => {
        delete process.env.BLOG_CMS_URL;
        delete process.env.BLOG_CMS_DELIVERY_TOKEN;
        delete process.env.BLOG_CMS_PREVIEW_TOKEN;
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });
    it('loads related translations and tags without exposing the credential', async () => {
        const rows = await service.articles();
        expect(rows[0].translations[0].title).toBe('Title');
        expect(rows[0].tags).toEqual([{ id: 'news', name: 'News' }]);
        expect(JSON.stringify(rows)).not.toContain('test-token');
    });
    it('reports upstream failure instead of an empty archive', async () => {
        process.env.BLOG_CMS_DELIVERY_TOKEN = 'wrong';
        await expect(service.articles()).rejects.toMatchObject({ status: 503 });
    });
    it('uses the separate preview credential only for preview reads', async () => {
        process.env.BLOG_CMS_DELIVERY_TOKEN = 'wrong';
        process.env.BLOG_CMS_PREVIEW_TOKEN = 'test-token';
        await expect(service.articles()).rejects.toMatchObject({ status: 503 });
        expect((await service.articles(true))[0].id).toBe('a');
    });
    it('selects and counts complete published translations from CMS responses', async () => {
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            const translation = (article_id: string, locale: string, status: string, published_at: string) =>
                ({ id: article_id + locale, article_id, locale, status, title: locale + article_id, content: '<p>Body</p>', excerpt: 'Excerpt', cover_alt: 'Cover', published_at });
            const rows: Record<string, unknown[]> = {
                blog_articles: ['b', 'a', 'c'].map((id) => ({ id, profile_user_id: 'author', cover: 'cover', game_id: null, rating: null })),
                blog_translations: [translation('a', 'en', 'published', '2025-01-01'), translation('a', 'pt-BR', 'draft', '2025-01-02'),
                    translation('b', 'pt-BR', 'published', '2025-01-01'), translation('c', 'pt-BR', 'draft', '2025-01-03')],
                blog_tags: [{ id: 'review', name: 'Review' }, { id: 'hidden', name: 'Hidden' }],
                blog_article_tags: [{ id: 1, article_id: 'a', tag_id: 'review' }, { id: 2, article_id: 'b', tag_id: 'review' }, { id: 3, article_id: 'c', tag_id: 'hidden' }],
            };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: rows[new URL(req.url!, 'http://localhost').pathname.split('/').pop()!] ?? [] }));
        });
        const delivery = new BlogDeliveryService(service);
        const [page, count] = await delivery.list('pt-BR', 'review', 1, 1);
        expect(count).toBe(2);
        expect(page.map((row) => [row.article.id, row.resolvedLocale, row.translation.title])).toEqual([['b', 'pt-BR', 'pt-BRb']]);
        expect((await delivery.one('a', 'pt-BR')).resolvedLocale).toBe('en');
        await expect(delivery.one('c', 'pt-BR')).rejects.toMatchObject({ status: 404 });
        expect(await delivery.tags('pt-BR')).toEqual([{ id: 'review', name: 'Review' }]);
    });
});
