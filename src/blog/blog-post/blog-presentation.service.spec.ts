import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlogPresentationService } from './blog-presentation.service';
import { CmsArticle, CmsTranslation } from './blog-selection';

const { mediaReference } = require('./blog-media.cjs');
const id = 'abc12345-0000-4000-8000-0123456789ab';
const coverName = 'a'.repeat(64) + '.webp';
const inlineName = 'b'.repeat(64) + '.webp';
const article: Omit<CmsArticle, 'translations'> = { id: 'article', profile_user_id: 'author', cover: id, game_id: '42', rating: 4, tags: [{ id: 'review', name: 'Review' }] };
const translation: CmsTranslation = { locale: 'en', status: 'published', title: 'Title', content: `<p onclick="bad()">Hi<script>bad()</script></p><img src="/assets/${id}?width=300" alt="Cover">`, excerpt: 'Excerpt', cover_alt: 'Cover', published_at: '2025-01-01', media_map: {
    [mediaReference(`/assets/${id}`, 'https://cms.example').name]: coverName,
    [mediaReference(`/assets/${id}?width=300`, 'https://cms.example').name]: inlineName,
} };

describe('blog presentation', () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'blog-media-'));
        process.env.BLOG_PUBLIC_MEDIA_PATH = root;
        process.env.BLOG_CMS_PUBLIC_URL = 'https://cms.example';
        process.env.DOMAIN_API = 'https://api.example';
    });
    afterEach(async () => {
        delete process.env.BLOG_PUBLIC_MEDIA_PATH;
        delete process.env.BLOG_CMS_PUBLIC_URL;
        delete process.env.DOMAIN_API;
        await rm(root, { recursive: true, force: true });
    });
    it('returns sanitized content and public media only after both images are ready', async () => {
        const service = new BlogPresentationService();
        await expect(service.present(article, translation, 'en', ['en'])).rejects.toMatchObject({ status: 503 });
        for (const name of [coverName, inlineName]) {
            await writeFile(join(root, name), 'image');
        }
        const result = await service.present(article, translation, 'en', ['en']);
        expect(result.cover?.url).toMatch(/^https:\/\/api\.example\/v1\/blog\/media\/[a-f0-9]{64}\.webp$/);
        expect(result.content).toContain('/v1/blog/media/');
        expect(result.content).not.toMatch(/script|onclick|\/assets\//);
        expect(result.review).toEqual({ gameId: 42, rating: 4 });
    });
    it('uses authenticated preview media and sanitizes draft HTML', async () => {
        const result = await new BlogPresentationService().present(article, { ...translation, status: 'draft' }, 'pt-BR', [], true);
        expect(result.cover?.url).toContain(`/v1/blog/preview/media/${id}`);
        expect(result.content).toContain('/v1/blog/preview/media/');
        expect(result.content).not.toMatch(/script|onclick/);
        expect(result).toHaveProperty('status', 'draft');
    });
});
