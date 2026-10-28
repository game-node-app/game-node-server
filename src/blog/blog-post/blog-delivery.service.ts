import { Injectable, NotFoundException } from '@nestjs/common';
import { BlogCmsService } from './blog-cms.service';
import { BlogLocale, selectPublishedArticles } from './blog-selection';

@Injectable()
export class BlogDeliveryService {
    constructor(private readonly cms: BlogCmsService) {}

    async list(locale: BlogLocale, tag: string | undefined, offset: number, limit: number) {
        const selected = selectPublishedArticles(await this.cms.articles(), locale, tag);
        return [selected.slice(offset, offset + limit), selected.length] as const;
    }

    async one(id: string, locale: BlogLocale) {
        const selected = selectPublishedArticles(await this.cms.articles(), locale).find((row) => row.article.id === id);
        if (!selected) throw new NotFoundException('Blog article not found');
        return selected;
    }

    async tags(locale: BlogLocale) {
        const selected = selectPublishedArticles(await this.cms.articles(), locale);
        return [...new Map(selected.flatMap((row) => row.article.tags.map((tag) => [tag.id, tag] as const))).values()]
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    async preview(id: string, locale: BlogLocale) {
        const article = (await this.cms.articles(true)).find((item) => item.id === id);
        const translation = article?.translations.find((item) => item.locale === locale);
        if (!article || !translation) throw new NotFoundException('Blog translation not found');
        const { translations: _translations, ...shared } = article;
        const availableLocales = (['en', 'pt-BR'] as BlogLocale[]).filter((language) => article.translations.some((item) => item.locale === language && item.status === 'published'));
        return { article: shared, translation, availableLocales };
    }
}
