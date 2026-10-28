import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { mkdir, copyFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const require = createRequire(realpathSync('/directus/node_modules/@directus/api/package.json'));
const { InvalidPayloadError } = require('@directus/errors');
const { parseDocument } = require('htmlparser2');
const { mediaReference } = require('/directus/blog-media.cjs');
const stageDir = '/directus/uploads/.blog-staging';
const publicDir = '/directus/public-media';
const filename = /^[a-f0-9]{64}\.webp$/;
const parseMap = (value) => typeof value === 'string' ? JSON.parse(value) : (value || {});

export default ({ filter, action, schedule }, { env, database, logger }) => {
    function coverReference(article) {
        return mediaReference('/assets/' + article.cover, String(env.PUBLIC_URL));
    }
    function references(article, translation) {
        const refs = [coverReference(article)];
        function visit(nodes) {
            for (const node of nodes) {
                if (node.name === 'img') {
                    if (!node.attribs?.src) throw new Error('Images require a source.');
                    const ref = mediaReference(node.attribs.src, String(env.PUBLIC_URL));
                    if (ref) refs.push(ref);
                }
                if (node.children) visit(node.children);
            }
        }
        visit(parseDocument(translation.content).children);
        return [...new Map(refs.map((ref) => [ref.name, ref])).values()];
    }
    async function exists(file) {
        try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }
    async function stage(refs) {
        if (!env.BLOG_CMS_PREVIEW_TOKEN) throw new Error('Preview credential is not configured.');
        await mkdir(stageDir, { recursive: true });
        const map = {};
        for (const ref of refs) {
            const response = await fetch(`http://127.0.0.1:8055/assets/${ref.id}?${ref.query}`, {
                headers: { Authorization: `Bearer ${env.BLOG_CMS_PREVIEW_TOKEN}` }, signal: AbortSignal.timeout(15000),
            });
            if (!response.ok || !response.headers.get('content-type')?.startsWith('image/webp')) throw new Error('Could not prepare an editorial image.');
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > 20 * 1024 * 1024) throw new Error('Prepared image exceeds 20 MiB.');
                chunks.push(chunk);
            }
            const bytes = Buffer.concat(chunks);
            const name = createHash('sha256').update(bytes).digest('hex') + '.webp';
            map[ref.name] = name;
            const destination = path.join(stageDir, name);
            if (await exists(destination) || await exists(path.join(publicDir, name))) continue;
            const temporary = destination + '.' + randomUUID();
            try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, destination); }
            catch (error) { await unlink(temporary).catch(() => {}); throw error; }
        }
        return map;
    }
    async function prepare(refs) {
        try { return await stage(refs); }
        catch (error) { throw new InvalidPayloadError({ reason: `Image preparation failed: ${error.message}` }); }
    }
    filter('blog_translations.items.create', async (payload, _meta, { database: db }) => {
        if ('media_map' in payload) throw new InvalidPayloadError({ reason: 'Media metadata is managed by the CMS.' });
        if (payload.status === 'published') {
            const article = await db('blog_articles').where({ id: payload.article_id }).first();
            payload.media_map = await prepare(references(article, payload));
        }
        return payload;
    });
    filter('blog_translations.items.update', async (payload, meta, { database: db }) => {
        if ('media_map' in payload) throw new InvalidPayloadError({ reason: 'Media metadata is managed by the CMS.' });
        const rows = await db('blog_translations').whereIn('id', meta.keys);
        const published = rows.map((row) => ({ ...row, ...payload })).filter((row) => row.status === 'published');
        if (published.length > 1) throw new InvalidPayloadError({ reason: 'Update published translations individually.' });
        if (published.length) {
            const translation = published[0];
            const article = await db('blog_articles').where({ id: translation.article_id }).first();
            payload.media_map = await prepare(references(article, translation));
        }
        return payload;
    });
    filter('blog_articles.items.update', async (payload, meta, { database: db }) => {
        if ('pending_cover_key' in payload || 'pending_cover_name' in payload) throw new InvalidPayloadError({ reason: 'Media metadata is managed by the CMS.' });
        if (!('cover' in payload)) return payload;
        const rows = await db('blog_articles').whereIn('id', meta.keys);
        const affected = [];
        for (const row of rows) if (await db('blog_translations').where({ article_id: row.id, status: 'published' }).first()) affected.push(row);
        if (affected.length > 1) throw new InvalidPayloadError({ reason: 'Update published article covers individually.' });
        if (affected.length) {
            const ref = coverReference({ ...affected[0], ...payload });
            const map = await prepare([ref]);
            payload.pending_cover_key = ref.name;
            payload.pending_cover_name = map[ref.name];
        }
        return payload;
    });
    async function publish(name) {
        if (!filename.test(name)) throw new Error('Invalid publication media name.');
        const destination = path.join(publicDir, name);
        if (await exists(destination)) return;
        await mkdir(publicDir, { recursive: true });
        const temporary = destination + '.' + randomUUID();
        try { await copyFile(path.join(stageDir, name), temporary); await rename(temporary, destination); }
        catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    }
    async function publishAll() {
        const articles = await database('blog_articles').whereNotNull('pending_cover_name');
        for (const article of articles) {
            try {
                await publish(article.pending_cover_name);
                await database.transaction(async (trx) => {
                    const current = await trx('blog_articles').where({ id: article.id }).forUpdate().first();
                    if (current.pending_cover_key !== article.pending_cover_key || current.pending_cover_name !== article.pending_cover_name) return;
                    const translations = await trx('blog_translations').where({ article_id: article.id, status: 'published' }).forUpdate();
                    for (const translation of translations) {
                        const map = parseMap(translation.media_map);
                        map[article.pending_cover_key] = article.pending_cover_name;
                        await trx('blog_translations').where({ id: translation.id }).update({ media_map: JSON.stringify(map) });
                    }
                    await trx('blog_articles').where({ id: article.id }).update({ pending_cover_key: null, pending_cover_name: null });
                });
            } catch (error) { logger.error(error, 'Could not publish a blog cover'); }
        }
        const translations = await database('blog_translations').where({ status: 'published' });
        const used = new Set();
        for (const translation of translations) {
            for (const name of Object.values(parseMap(translation.media_map))) {
                used.add(name);
                try { await publish(name); } catch (error) { logger.error(error, 'Could not publish blog media'); }
            }
        }
        for (const article of articles) used.add(article.pending_cover_name);
        for (const name of await readdir(stageDir).catch(() => [])) {
            if (!filename.test(name) || used.has(name)) continue;
            const file = path.join(stageDir, name);
            if (Date.now() - (await stat(file)).mtimeMs > 86400000) await unlink(file);
        }
    }
    for (const event of ['blog_translations.items.create', 'blog_translations.items.update', 'blog_articles.items.update']) {
        action(event, () => publishAll().catch((error) => logger.error(error, 'Could not publish blog media')));
    }
    schedule('* * * * *', () => publishAll().catch((error) => logger.error(error, 'Could not publish blog media')));
};
