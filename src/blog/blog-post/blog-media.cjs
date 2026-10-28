const { createHash } = require('node:crypto');

const keys = new Set(['key', 'transforms', 'width', 'height', 'format', 'fit', 'quality', 'withoutEnlargement', 'focal_point_x', 'focal_point_y']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mediaReference(source, cmsUrl) {
    const base = new URL(cmsUrl);
    const url = new URL(source, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/assets/')) return null;
    const id = url.pathname.split('/')[2];
    if (!uuid.test(id)) throw new Error('Invalid CMS asset reference');
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
        if (!keys.has(key) || params.has(key)) throw new Error('Invalid CMS asset transformation');
        params.append(key, value);
    }
    params.set('format', 'webp');
    params.sort();
    const query = params.toString();
    const name = createHash('sha256').update(id.toLowerCase() + '?' + query).digest('hex') + '.webp';
    return { id, query, name };
}

module.exports = { mediaReference };
