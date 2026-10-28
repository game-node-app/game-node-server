export default {
    id: 'blog-game-search',
    handler: (router, { env, database }) => {
        router.get('/', async (req, res) => {
            if (!req.accountability?.user) return res.status(403).json({ error: 'Access denied.' });
            if (!req.accountability.admin) {
                const role = await database('directus_roles').where({ id: req.accountability.role, name: 'Blog editor' }).first('id');
                if (!role) return res.status(403).json({ error: 'Access denied.' });
            }
            const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            if (!query || query.length > 100) return res.status(400).json({ error: 'Enter a game name of at most 100 characters.' });
            if (!env.BLOG_REFERENCE_API_URL) return res.status(503).json({ error: 'Game search is unavailable.' });
            try {
                const response = await fetch(`${String(env.BLOG_REFERENCE_API_URL).replace(/\/$/, '')}/search/games`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, limit: 10 }), signal: AbortSignal.timeout(5000),
                });
                if (!response.ok) throw new Error('Game search failed');
                const data = await response.json();
                if (!Array.isArray(data.data?.items)) throw new Error('Invalid search response');
                return res.json({ data: data.data.items.map(({ id, name }) => ({ id, name })) });
            } catch {
                return res.status(503).json({ error: 'Game search is unavailable.' });
            }
        });
    },
};
