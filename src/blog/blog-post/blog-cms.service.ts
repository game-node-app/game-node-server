import { HttpService } from '@nestjs/axios';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CmsArticle, CmsTranslation } from './blog-selection';

type Translation = CmsTranslation & { article_id: string };
type Article = Omit<CmsArticle, 'translations' | 'tags'>;
type Tag = { id: string; name: string };
type Link = { article_id: string; tag_id: string };

@Injectable()
export class BlogCmsService {
    constructor(private readonly http: HttpService) {}

    private async all<T>(collection: string, preview: boolean): Promise<T[]> {
        const base = process.env.BLOG_CMS_URL;
        const token = preview ? process.env.BLOG_CMS_PREVIEW_TOKEN : process.env.BLOG_CMS_DELIVERY_TOKEN;
        if (!base || !token) throw new ServiceUnavailableException('Blog CMS is not configured');
        const result: T[] = [];
        try {
            while (true) {
                const response = await this.http.axiosRef.get<{ data: T[] }>(`${base.replace(/\/$/, '')}/items/${collection}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    params: { limit: 100, offset: result.length, sort: 'id' },
                    timeout: 5000,
                    maxRedirects: 0,
                });
                if (!Array.isArray(response.data.data)) throw new Error('Invalid CMS response');
                result.push(...response.data.data);
                if (response.data.data.length < 100) return result;
            }
        } catch {
            throw new ServiceUnavailableException('Blog CMS is unavailable');
        }
    }

    async articles(preview = false): Promise<CmsArticle[]> {
        const [articles, translations, tags, links] = await Promise.all([
            this.all<Article>('blog_articles', preview), this.all<Translation>('blog_translations', preview),
            this.all<Tag>('blog_tags', preview), this.all<Link>('blog_article_tags', preview),
        ]);
        const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
        return articles.map((article) => ({
            ...article,
            translations: translations.filter((translation) => translation.article_id === article.id),
            tags: links.filter((link) => link.article_id === article.id)
                .flatMap((link) => tagsById.has(link.tag_id) ? [tagsById.get(link.tag_id)!] : []),
        }));
    }
}
