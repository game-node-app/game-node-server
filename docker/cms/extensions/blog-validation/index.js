import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';

const require = createRequire(realpathSync('/directus/node_modules/@directus/api/package.json'));
const { InvalidPayloadError } = require('@directus/errors');
const { parseDocument } = require('htmlparser2');
const invalid = (reason) => { throw new InvalidPayloadError({ reason }); };

function validateImages(nodes) {
    for (const node of nodes) {
        if (node.name === 'img' && !node.attribs?.alt?.trim()) invalid('Every image needs a description.');
        if (node.children) validateImages(node.children);
    }
}

export default ({ filter }, { env }) => {
    async function reference(path, method = 'GET') {
        if (!env.BLOG_REFERENCE_API_URL) invalid('Reference API is not configured.');
        let response;
        try {
            response = await fetch(`${String(env.BLOG_REFERENCE_API_URL).replace(/\/$/, '')}${path}`, {
                method, headers: { 'Content-Type': 'application/json' },
                ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(5000),
            });
        } catch { invalid('Reference API is unavailable; save the draft and try again.'); }
        if (!response.ok) invalid('Author or game could not be verified; save the draft and check the reference.');
    }

    async function validate(db, article, translation, tags) {
        if (!article?.profile_user_id || !article.cover) invalid('An author and cover are required.');
        for (const field of ['title', 'content', 'excerpt', 'cover_alt']) {
            if (typeof translation[field] !== 'string' || !translation[field].trim()) invalid(`${field} is required to publish.`);
        }
        if (!['en', 'pt-BR'].includes(translation.locale) || !translation.published_at || Number.isNaN(Date.parse(translation.published_at))) invalid('A supported locale and publication date are required.');
        validateImages(parseDocument(translation.content).children);
        const isReview = tags.includes('review');
        const hasGame = article.game_id != null && String(article.game_id).trim() !== '';
        const hasRating = article.rating != null;
        if (isReview !== hasGame || isReview !== hasRating || (hasRating && (!Number.isFinite(Number(article.rating)) || Number(article.rating) < 0 || Number(article.rating) > 5))) invalid('The review tag requires a game and a rating from 0 to 5; other articles must not have review facts.');
        await reference('/profile/' + encodeURIComponent(article.profile_user_id));
        if (hasGame) await reference('/game/repository/' + encodeURIComponent(article.game_id), 'POST');
    }

    async function tagsFor(db, id) {
        return (await db('blog_article_tags').where({ article_id: id }).select('tag_id')).map((row) => row.tag_id);
    }
    async function validateArticle(db, article, tags) {
        const translations = await db('blog_translations').where({ article_id: article.id, status: 'published' });
        for (const translation of translations) await validate(db, article, translation, tags);
    }
    filter('blog_translations.items.create', async (payload, _meta, { database: db }) => {
        if (payload.status === 'published') await validate(db, await db('blog_articles').where({ id: payload.article_id }).first(), payload, await tagsFor(db, payload.article_id));
        return payload;
    });
    filter('blog_translations.items.update', async (payload, meta, { database: db }) => {
        const rows = await db('blog_translations').whereIn('id', meta.keys);
        for (const old of rows) {
            const translation = { ...old, ...payload };
            if (translation.status === 'published') await validate(db, await db('blog_articles').where({ id: translation.article_id }).first(), translation, await tagsFor(db, translation.article_id));
        }
        return payload;
    });
    filter('blog_articles.items.update', async (payload, meta, { database: db }) => {
        for (const old of await db('blog_articles').whereIn('id', meta.keys)) await validateArticle(db, { ...old, ...payload }, await tagsFor(db, old.id));
        return payload;
    });
    for (const action of ['create', 'update', 'delete']) {
        filter(`blog_article_tags.items.${action}`, async (payload, meta, { database: db }) => {
            const old = action === 'create' ? [] : await db('blog_article_tags').whereIn('id', action === 'delete' ? payload : meta.keys);
            const next = action === 'delete' ? [] : action === 'create' ? [payload] : old.map((row) => ({ ...row, ...payload }));
            const ids = new Set([...old, ...next].map((row) => row.article_id));
            for (const id of ids) {
                const rows = await db('blog_article_tags').where({ article_id: id });
                const remaining = rows.filter((row) => !old.some((removed) => removed.id === row.id));
                const tags = [...remaining, ...next.filter((row) => row.article_id === id)].map((row) => row.tag_id);
                const article = await db('blog_articles').where({ id }).first();
                if (article) await validateArticle(db, article, tags);
            }
            return payload;
        });
    }
};
