import { BlogCmsService } from './blog-cms.service';
import { BlogDeliveryService } from './blog-delivery.service';
import { CmsArticle, CmsTranslation } from './blog-selection';

const translation = (locale: string, status: string, published_at = '2025-01-01'): CmsTranslation => ({ locale, status, title: locale, content: '<p>Body</p>', excerpt: 'Excerpt', cover_alt: 'Cover', published_at });
const article = (id: string, translations: CmsTranslation[], tag: string): CmsArticle => ({ id, profile_user_id: 'author', cover: 'cover', game_id: null, rating: null, translations, tags: [{ id: tag, name: tag }] });

describe('blog delivery', () => {
    const cms = { articles: jest.fn() };
    const delivery = new BlogDeliveryService(cms as unknown as BlogCmsService);
    beforeEach(() => cms.articles.mockResolvedValue([
        article('b', [translation('en', 'published'), translation('pt-BR', 'draft')], 'review'),
        article('a', [translation('en', 'published'), translation('pt-BR', 'published')], 'review'),
        article('c', [translation('pt-BR', 'draft')], 'hidden'),
        article('d', [translation('en', 'published', '2099-01-01T00:00:00Z'), translation('pt-BR', 'published', '2099-01-01T00:00:00Z')], 'scheduled'),
    ]));
    it('counts filtered articles before pagination and falls back as a whole', async () => {
        const [rows, count] = await delivery.list('pt-BR', 'review', 1, 1);
        expect(count).toBe(2);
        expect(rows.map((row) => [row.article.id, row.resolvedLocale, row.translation.title])).toEqual([['b', 'en', 'en']]);
    });
    it('hides draft-only and future-scheduled tags and returns 404 for detail', async () => {
        expect(await delivery.tags('en')).toEqual([{ id: 'review', name: 'review' }]);
        await expect(delivery.one('c', 'en')).rejects.toMatchObject({ status: 404 });
        await expect(delivery.one('d', 'en')).rejects.toMatchObject({ status: 404 });
    });
    it('previews the exact requested translation using the preview credential', async () => {
        const row = await delivery.preview('b', 'pt-BR');
        expect(cms.articles).toHaveBeenCalledWith(true);
        expect(row.translation).toMatchObject({ locale: 'pt-BR', status: 'draft' });
        const scheduled = await delivery.preview('d', 'pt-BR');
        expect(scheduled.translation).toMatchObject({ locale: 'pt-BR', status: 'published' });
        expect(scheduled.availableLocales).toEqual([]);
        await expect(delivery.preview('c', 'en')).rejects.toMatchObject({ status: 404 });
    });
});
