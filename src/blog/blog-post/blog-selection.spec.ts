import { CmsArticle, CmsTranslation, selectPublishedArticles } from './blog-selection';

const published = (locale: string, date = '2025-01-01T00:00:00Z'): CmsTranslation => ({
    locale, status: 'published', title: locale, content: '<p>body</p>', excerpt: 'text', cover_alt: 'cover', published_at: date,
});
const article = (id: string, translations: CmsTranslation[], tags = ['review']): CmsArticle => ({
    id, profile_user_id: 'author', cover: 'cover', game_id: null, rating: null,
    tags: tags.map((tag) => ({ id: tag, name: tag })), translations,
});

describe('published blog selection', () => {
    it('selects complete translations before tag filtering and stable pagination', () => {
        const rows = [article('b', [published('en'), { ...published('pt-BR'), status: 'draft' }]),
            article('a', [published('en'), published('pt-BR')]), article('c', [{ ...published('pt-BR'), content: '' }]),
            article('d', [published('en', '2026-01-01T00:00:00Z')], ['other'])];
        const result = selectPublishedArticles(rows, 'pt-BR', 'review');
        expect(result.map((row) => row.article.id)).toEqual(['a', 'b']);
        expect(result[0].resolvedLocale).toBe('pt-BR');
        expect(result[1].resolvedLocale).toBe('en');
        expect(result[1].translation.title).toBe('en');
        expect(result[1].availableLocales).toEqual(['en']);
        expect(result.slice(1, 2).map((row) => row.article.id)).toEqual(['b']);
    });
    it('does not use Portuguese as an English fallback or return incomplete articles', () => {
        expect(selectPublishedArticles([article('a', [published('pt-BR')]),
            { ...article('b', [published('en')]), cover: null }], 'en')).toEqual([]);
    });
    it('withholds scheduled translations until published_at is reached', () => {
        const now = Date.parse('2026-12-01T11:59:59Z');
        const rows = [
            article('scheduled', [published('en', '2026-12-01T12:00:00Z'), published('pt-BR', '2026-12-01T12:00:00Z')]),
            article('partial', [published('en', '2026-11-20T12:00:00Z'), published('pt-BR', '2026-12-01T12:00:00Z')]),
        ];
        const before = selectPublishedArticles(rows, 'pt-BR', undefined, now);
        expect(before.map((row) => [row.article.id, row.resolvedLocale, row.availableLocales])).toEqual([['partial', 'en', ['en']]]);

        const atLaunch = selectPublishedArticles(rows, 'pt-BR', undefined, Date.parse('2026-12-01T12:00:00Z'));
        expect(atLaunch.map((row) => [row.article.id, row.resolvedLocale, row.availableLocales])).toEqual([
            ['partial', 'pt-BR', ['en', 'pt-BR']],
            ['scheduled', 'pt-BR', ['en', 'pt-BR']],
        ]);
    });
});
