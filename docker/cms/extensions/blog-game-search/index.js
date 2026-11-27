// Searches or looks up GameNode games (default) and users for the editor pickers; answers { data: [{ id, name }] }.
export default {
    id: 'blog-game-search',
    handler: (router, { env, database }) => {
        router.get('/', async (req, res) => {
            if (!req.accountability?.user) return res.status(403).json({ error: 'Access denied.' });
            if (!req.accountability.admin) {
                const role = await database('directus_roles').where({ id: req.accountability.role, name: 'Blog editor' }).first('id');
                if (!role) return res.status(403).json({ error: 'Access denied.' });
            }
            const users = req.query.type === 'users';
            const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
            const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            if (id ? id.length > 64 : !query || query.length > 100) return res.status(400).json({ error: 'Enter a search of at most 100 characters.' });
            if (!env.BLOG_REFERENCE_API_URL) return res.status(503).json({ error: 'Search is unavailable.' });
            const base = String(env.BLOG_REFERENCE_API_URL).replace(/\/$/, '');
            const call = async (path, body) => {
                const response = await fetch(base + path, {
                    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
                    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
                });
                if (response.status === 404 && id) return null;
                if (!response.ok) throw new Error('Search failed');
                return response.json();
            };
            try {
                if (id) {
                    const found = users ? await call('/profile/' + encodeURIComponent(id)) : await call('/game/repository/' + encodeURIComponent(id), {});
                    const name = found && (users ? found.username : found.name);
                    return res.json({ data: name ? [{ id, name }] : [] });
                }
                const data = await call(users ? '/search/users' : '/search/games', { query, limit: 10 });
                if (!Array.isArray(data.data?.items)) throw new Error('Invalid search response');
                return res.json({ data: data.data.items.map((item) => users ? { id: item.userId, name: item.username } : { id: item.id, name: item.name }) });
            } catch {
                return res.status(503).json({ error: 'Search is unavailable.' });
            }
        });
    },
};
