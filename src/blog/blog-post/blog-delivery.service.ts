import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { minutes } from '@nestjs/throttler';
import { BlogCmsService } from './blog-cms.service';
import { BlogPresentationService } from './blog-presentation.service';
import { BlogLocale, isPublishedTranslation, selectPublishedArticles } from './blog-selection';

type Presented = Awaited<ReturnType<BlogPresentationService['present']>>;

@Injectable()
export class BlogDeliveryService {
    constructor(
        private readonly cms: BlogCmsService,
        private readonly presentation: BlogPresentationService,
        @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    ) {}

    async list(locale: BlogLocale, tag: string | undefined, offset: number, limit: number): Promise<readonly [Presented[], number]> {
        const articles = await this.presented(locale);
        const matching = tag ? articles.filter((article) => article.tags.some((item) => item.id === tag)) : articles;
        return [matching.slice(offset, offset + limit), matching.length] as const;
    }

    async one(id: string, locale: BlogLocale) {
        const article = (await this.presented(locale)).find((item) => item.id === id);
        if (!article) throw new NotFoundException('Blog article not found');
        return article;
    }

    async tags(locale: BlogLocale) {
        const articles = await this.presented(locale);
        return [...new Map(articles.flatMap((article) => article.tags.map((tag) => [tag.id, tag] as const))).values()]
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    async preview(id: string, locale: BlogLocale) {
        const article = (await this.cms.articles(true)).find((item) => item.id === id);
        const translation = article?.translations.find((item) => item.locale === locale);
        if (!article || !translation) throw new NotFoundException('Blog translation not found');
        const { translations: _translations, ...shared } = article;
        const now = Date.now();
        const availableLocales = (['en', 'pt-BR'] as BlogLocale[]).filter((language) => article.translations.some((item) => item.locale === language && isPublishedTranslation(item, now)));
        return { article: shared, translation, availableLocales };
    }

    // One sanitized, media-verified dataset per locale is shared by list, detail and tags; failures are never cached.
    private async presented(locale: BlogLocale): Promise<Presented[]> {
        const key = `blog:presented:v1:${locale}`;
        const cached = await this.cache?.get<Presented[]>(key).catch(() => undefined);
        if (cached != null) return cached;
        const articles = await Promise.all(selectPublishedArticles(await this.cms.articles(), locale).map((row) =>
            this.presentation.present(row.article, row.translation, row.requestedLocale, row.availableLocales)));
        await this.cache?.set(key, articles, minutes(10)).catch(() => undefined);
        return articles;
    }
}
