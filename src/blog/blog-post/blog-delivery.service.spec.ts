import { Cache } from '@nestjs/cache-manager';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlogCmsService } from './blog-cms.service';
import { BlogDeliveryService } from './blog-delivery.service';
import { BlogPresentationService } from './blog-presentation.service';
import { CmsArticle, CmsTranslation } from './blog-selection';

const { mediaReference } = require('./blog-media.cjs');

const translation = (locale: string, status: string, published_at = '2025-01-01'): CmsTranslation => ({ locale, status, title: locale, content: '<p>Body</p>', excerpt: 'Excerpt', cover_alt: 'Cover', published_at });
const article = (id: string, translations: CmsTranslation[], tag: string): CmsArticle => ({ id, profile_user_id: 'author', cover: 'cover', game_id: null, rating: null, translations, tags: [{ id: tag, name: tag }] });
const present = async (article: Omit<CmsArticle, 'translations'>, translation: CmsTranslation, requestedLocale: string, availableLocales: string[]) => ({
    id: article.id, title: translation.title, content: translation.content, tags: article.tags, requestedLocale, resolvedLocale: translation.locale, availableLocales,
});

describe('blog delivery', () => {
    const cms = { articles: jest.fn() };
    const presentation = { present: jest.fn(present) };
    const cache = { get: jest.fn(), set: jest.fn() };
    const delivery = new BlogDeliveryService(cms as unknown as BlogCmsService, presentation as unknown as BlogPresentationService, cache as unknown as Cache);
    beforeEach(() => {
        jest.clearAllMocks();
        cache.get.mockResolvedValue(undefined);
        cache.set.mockResolvedValue(undefined);
        cms.articles.mockResolvedValue([
            article('b', [translation('en', 'published'), translation('pt-BR', 'draft')], 'review'),
            article('a', [translation('en', 'published'), translation('pt-BR', 'published')], 'review'),
            article('c', [translation('pt-BR', 'draft')], 'hidden'),
            article('d', [translation('en', 'published', '2099-01-01T00:00:00Z'), translation('pt-BR', 'published', '2099-01-01T00:00:00Z')], 'scheduled'),
        ]);
    });
    it('counts filtered articles before pagination and falls back as a whole', async () => {
        const [rows, count] = await delivery.list('pt-BR', 'review', 1, 1);
        expect(count).toBe(2);
        expect(rows.map((row) => [row.id, row.resolvedLocale, row.title])).toEqual([['b', 'en', 'en']]);
    });
    it('hides draft-only and future-scheduled tags and returns 404 for detail', async () => {
        expect(await delivery.tags('en')).toEqual([{ id: 'review', name: 'review' }]);
        await expect(delivery.one('c', 'en')).rejects.toMatchObject({ status: 404 });
        await expect(delivery.one('d', 'en')).rejects.toMatchObject({ status: 404 });
    });
    it('shares one sanitized, media-verified presentation per locale across list, detail, and tags', async () => {
        const stored = new Map<string, unknown>();
        cache.get.mockImplementation(async (key: string) => stored.get(key));
        cache.set.mockImplementation(async (key: string, value: unknown) => { stored.set(key, value); });
        await delivery.list('en', 'review', 0, 10);
        await delivery.one('a', 'en');
        await delivery.tags('en');
        expect(cms.articles).toHaveBeenCalledTimes(1);
        expect(presentation.present).toHaveBeenCalledTimes(2);
        expect(cache.set).toHaveBeenCalledWith('blog:presented:v1:en', expect.any(Array), 600000);
        expect([...stored.keys()]).toEqual(['blog:presented:v1:en']);
    });
    it('keys the presentation cache per locale', async () => {
        await delivery.list('en', undefined, 0, 10);
        await delivery.list('pt-BR', undefined, 0, 10);
        expect(presentation.present).toHaveBeenCalledTimes(4);
        expect(cache.set.mock.calls.map(([key]) => key)).toEqual(['blog:presented:v1:en', 'blog:presented:v1:pt-BR']);
    });
    it('filters tag pages without mutating the cached dataset', async () => {
        const stored = new Map<string, unknown>();
        cache.get.mockImplementation(async (key: string) => stored.get(key));
        cache.set.mockImplementation(async (key: string, value: unknown) => { stored.set(key, value); });
        await delivery.list('en', undefined, 0, 10);
        expect((await delivery.list('en', 'missing', 0, 10))[1]).toBe(0);
        expect((await delivery.list('en', undefined, 0, 10))[0]).toHaveLength(2);
        expect((stored.get('blog:presented:v1:en') as unknown[]).length).toBe(2);
    });
    it('previews the exact requested translation live, bypassing the public cache', async () => {
        const row = await delivery.preview('b', 'pt-BR');
        expect(cms.articles).toHaveBeenCalledWith(true);
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
        expect(row.translation).toMatchObject({ locale: 'pt-BR', status: 'draft' });
        const scheduled = await delivery.preview('d', 'pt-BR');
        expect(scheduled.translation).toMatchObject({ locale: 'pt-BR', status: 'published' });
        expect(scheduled.availableLocales).toEqual([]);
        await expect(delivery.preview('c', 'en')).rejects.toMatchObject({ status: 404 });
    });
    it('falls back to live CMS reads when the cache errors', async () => {
        cache.get.mockRejectedValue(new Error('cache down'));
        cache.set.mockRejectedValue(new Error('cache down'));
        const [rows, count] = await delivery.list('en', undefined, 0, 10);
        expect(count).toBe(2);
        expect(rows).toHaveLength(2);
    });
    it('serves repeated list, detail, and tag reads after the verified media disappears', async () => {
        const root = await mkdtemp(join(tmpdir(), 'blog-delivery-'));
        const coverId = 'abc12345-0000-4000-8000-0123456789ab';
        const coverName = 'a'.repeat(64) + '.webp';
        const inlineName = 'b'.repeat(64) + '.webp';
        process.env.BLOG_PUBLIC_MEDIA_PATH = root;
        process.env.BLOG_CMS_PUBLIC_URL = 'https://cms.example';
        process.env.DOMAIN_API = 'https://api.example';
        const stored = new Map<string, unknown>();
        cache.get.mockImplementation(async (key: string) => stored.get(key));
        cache.set.mockImplementation(async (key: string, value: unknown) => { stored.set(key, value); });
        const verified = new BlogDeliveryService(cms as unknown as BlogCmsService, new BlogPresentationService(), cache as unknown as Cache);
        cms.articles.mockResolvedValue([{ ...article('article', [{
            locale: 'en', status: 'published', title: 'Title', content: `<p>Hi</p><img src="/assets/${coverId}?width=300" alt="Cover">`, excerpt: 'Excerpt',
            cover_alt: 'Cover', published_at: '2025-01-01', media_map: {
                [mediaReference(`/assets/${coverId}`, 'https://cms.example').name]: coverName,
                [mediaReference(`/assets/${coverId}?width=300`, 'https://cms.example').name]: inlineName,
            },
        }], 'review'), cover: coverId }]);
        try {
            await writeFile(join(root, coverName), 'image');
            await writeFile(join(root, inlineName), 'image');
            const [rows] = await verified.list('en', undefined, 0, 10);
            expect(rows).toHaveLength(1);
            await rm(root, { recursive: true, force: true });
            expect((await verified.list('en', undefined, 0, 10))[0]).toEqual(rows);
            expect((await verified.one('article', 'en')).id).toBe('article');
            expect(await verified.tags('en')).toEqual([{ id: 'review', name: 'review' }]);
            expect(presentation.present).not.toHaveBeenCalled();
            expect(cms.articles).toHaveBeenCalledTimes(1);
            expect(cache.set).toHaveBeenCalledTimes(1);
        } finally {
            delete process.env.BLOG_PUBLIC_MEDIA_PATH;
            delete process.env.BLOG_CMS_PUBLIC_URL;
            delete process.env.DOMAIN_API;
            await rm(root, { recursive: true, force: true });
        }
    });
    it('never caches cold CMS or media failures', async () => {
        cms.articles.mockRejectedValueOnce(Object.assign(new Error('cms down'), { status: 503 }));
        await expect(delivery.list('en', undefined, 0, 10)).rejects.toMatchObject({ status: 503 });
        expect(cache.set).not.toHaveBeenCalled();
        presentation.present.mockRejectedValueOnce(Object.assign(new Error('media down'), { status: 503 }));
        await expect(delivery.one('a', 'en')).rejects.toMatchObject({ status: 503 });
        expect(cache.set).not.toHaveBeenCalled();
        const [rows] = await delivery.list('en', undefined, 0, 10);
        expect(rows).toHaveLength(2);
        expect(cache.set).toHaveBeenCalledTimes(1);
    });
});
