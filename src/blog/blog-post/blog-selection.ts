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

export function selectPublishedArticles(articles: CmsArticle[], locale: BlogLocale, tag?: string) {
    return articles.flatMap((article) => {
        if (!article.cover || (tag && !article.tags.some((item) => item.id === tag))) return [];
        const eligible = article.translations.filter((translation) =>
            (translation.locale === 'en' || translation.locale === 'pt-BR') &&
            translation.status === 'published' && Boolean(translation.title?.trim()) &&
            Boolean(translation.content?.trim()) && Boolean(translation.excerpt?.trim()) &&
            Boolean(translation.cover_alt?.trim()) && Boolean(translation.published_at) &&
            !Number.isNaN(Date.parse(translation.published_at!)),
        );
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
