import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { BlogLocale, CmsArticle, CmsTranslation } from './blog-selection';
import { sanitizeBlogHtml } from './blog-html';

const { mediaReference } = require('./blog-media.cjs') as {
    mediaReference: (source: string, cmsUrl: string) => { id: string; query: string; name: string } | null;
};

type Shared = Omit<CmsArticle, 'translations'>;

@Injectable()
export class BlogPresentationService {
    async present(article: Shared, translation: CmsTranslation, requestedLocale: BlogLocale, availableLocales: BlogLocale[], preview = false) {
        const cmsUrl = process.env.BLOG_CMS_PUBLIC_URL || process.env.BLOG_CMS_URL;
        const api = process.env.DOMAIN_API?.replace(/\/$/, '');
        if (!cmsUrl || !api) throw new ServiceUnavailableException('Blog media is not configured');
        const files: string[] = [];
        const media = (source: string) => {
            const ref = mediaReference(source, cmsUrl);
            if (!ref) return source;
            if (preview) return `${api}/v1/blog/preview/media/${ref.id}?${ref.query}`;
            const name = translation.media_map?.[ref.name];
            if (!name || !/^[a-f0-9]{64}\.webp$/.test(name)) throw new Error('Published media is not ready');
            files.push(name);
            return `${api}/v1/blog/media/${name}`;
        };
        let cover: { url: string; alt: string | null } | null = null;
        let content: string;
        try {
            if (article.cover) cover = { url: media('/assets/' + article.cover), alt: translation.cover_alt };
            content = sanitizeBlogHtml(translation.content ?? '', media);
            if (!preview && files.length) {
                const root = process.env.BLOG_PUBLIC_MEDIA_PATH;
                if (!root) throw new Error('Public media storage is not configured');
                await Promise.all(files.map((name) => access(join(root, name))));
            }
        } catch {
            throw new ServiceUnavailableException('Blog media is unavailable');
        }
        return {
            id: article.id, title: translation.title, content, excerpt: translation.excerpt,
            profileUserId: article.profile_user_id, tags: article.tags,
            review: article.game_id != null && article.rating != null ? { gameId: Number(article.game_id), rating: article.rating } : null,
            cover, publishedAt: translation.published_at, requestedLocale, resolvedLocale: translation.locale,
            availableLocales, ...(preview ? { status: translation.status } : {}),
        };
    }
}
