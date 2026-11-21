export type BlogLocale = 'en' | 'pt-BR';

export interface CmsTranslation {
    locale: string;
    status: string;
    title: string | null;
    content: string | null;
    excerpt: string | null;
    cover_alt: string | null;
    published_at: string | null;
    media_map?: Record<string, string> | null;
}

export interface CmsArticle {
    id: string;
    profile_user_id: string;
    cover: string | null;
    game_id: string | null;
    rating: number | null;
    tags: { id: string; name: string }[];
    translations: CmsTranslation[];
}

export function isPublishedTranslation(translation: CmsTranslation, now = Date.now()): boolean {
    if ((translation.locale !== 'en' && translation.locale !== 'pt-BR') || translation.status !== 'published') return false;
    if (!translation.title?.trim() || !translation.content?.trim() || !translation.excerpt?.trim() || !translation.cover_alt?.trim() || !translation.published_at) return false;
    const publishedAt = Date.parse(translation.published_at);
    return !Number.isNaN(publishedAt) && publishedAt <= now;
}

export function selectPublishedArticles(articles: CmsArticle[], locale: BlogLocale, tag?: string, now = Date.now()) {
    return articles.flatMap((article) => {
        if (!article.cover || (tag && !article.tags.some((item) => item.id === tag))) return [];
        const eligible = article.translations.filter((translation) => isPublishedTranslation(translation, now));
        const selected = eligible.find((item) => item.locale === locale) ?? eligible.find((item) => item.locale === 'en');
        if (!selected) return [];
        const { translations: _translations, ...publicArticle } = article;
        return [{ article: publicArticle, translation: selected, requestedLocale: locale, resolvedLocale: selected.locale as BlogLocale,
            availableLocales: (['en', 'pt-BR'] as BlogLocale[]).filter((language) => eligible.some((item) => item.locale === language)) }];
    }).sort((left, right) =>
        Date.parse(right.translation.published_at!) - Date.parse(left.translation.published_at!) ||
        (left.article.id < right.article.id ? -1 : left.article.id > right.article.id ? 1 : 0),
    );
}
