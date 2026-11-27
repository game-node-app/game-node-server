import { h, ref, watch, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

// Search-as-you-type picker that stores a GameNode game ID or user ID and shows its name.
export default {
    id: 'blog-game-picker', name: 'GameNode search', icon: 'sports_esports',
    description: 'Search GameNode games or users by name and store the ID.', types: ['string'],
    options: [{ field: 'kind', name: 'Search', type: 'string', meta: { width: 'half', interface: 'select-dropdown',
        options: { choices: [{ text: 'Games', value: 'games' }, { text: 'Users', value: 'users' }] } }, schema: { default_value: 'games' } }],
    component: {
        props: { value: String, disabled: Boolean, kind: { type: String, default: 'games' } },
        emits: ['input'],
        setup(props, { emit }) {
            const api = useApi();
            const users = props.kind === 'users';
            const words = users
                ? { placeholder: 'Digite o nome de usuário no GameNode…', icon: 'person', empty: 'Nenhum usuário encontrado.' }
                : { placeholder: 'Digite o nome do jogo…', icon: 'sports_esports', empty: 'Nenhum jogo encontrado.' };
            const query = ref('');
            const results = ref(null);
            const selected = ref({ id: null, name: '' });
            const error = ref('');
            const loading = ref(false);
            let timer;
            let latest = 0;

            async function get(params) {
                return (await api.get('/blog-game-search', { params: { ...params, type: props.kind } })).data.data;
            }
            async function search() {
                const q = query.value.trim();
                const request = ++latest;
                if (q.length < 2) { results.value = null; return; }
                loading.value = true;
                error.value = '';
                try {
                    const found = await get({ q });
                    if (request === latest) results.value = found;
                } catch {
                    if (request === latest) { results.value = null; error.value = 'A busca falhou. Tente de novo em instantes.'; }
                } finally { if (request === latest) loading.value = false; }
            }
            watch(() => props.value, async (id) => {
                if (!id || selected.value.id === id) return;
                selected.value = { id, name: '' };
                let name;
                try { name = (await get({ id }))[0]?.name ?? 'Não encontrado no GameNode'; } catch { name = 'Não foi possível carregar o nome'; }
                if (selected.value.id === id) selected.value = { id, name };
            }, { immediate: true });
            function choose(item) {
                selected.value = { id: String(item.id), name: item.name };
                query.value = '';
                results.value = null;
                emit('input', String(item.id));
            }
            function clear() { selected.value = { id: null, name: '' }; emit('input', null); }

            return () => {
                const [VInput, VIcon, VButton, VNotice, VList, VListItem, VListItemContent] =
                    ['v-input', 'v-icon', 'v-button', 'v-notice', 'v-list', 'v-list-item', 'v-list-item-content'].map((name) => resolveComponent(name));
                const card = props.value && h('div', { style: 'display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;border:var(--theme--border-width) solid var(--theme--primary);border-radius:var(--theme--border-radius);background:var(--theme--primary-background)' }, [
                    h(VIcon, { name: words.icon }),
                    h('div', { style: 'flex:1' }, [
                        h('div', { style: 'font-weight:600' }, selected.value.name || 'Carregando…'),
                        h('div', { style: 'font-size:12px;color:var(--theme--foreground-subdued)' }, 'ID ' + props.value),
                    ]),
                    !props.disabled && h(VButton, { secondary: true, small: true, onClick: clear }, () => 'Remover'),
                ]);
                return h('div', [
                    card,
                    !props.disabled && h(VInput, {
                        modelValue: query.value, placeholder: props.value ? 'Buscar para trocar…' : words.placeholder,
                        'onUpdate:modelValue': (text) => { query.value = text; clearTimeout(timer); timer = setTimeout(search, 300); },
                    }, { prepend: () => h(VIcon, { name: loading.value ? 'hourglass_empty' : 'search' }) }),
                    results.value && h(VList, { style: 'margin-top:4px;border:var(--theme--border-width) solid var(--theme--form--field--input--border-color);border-radius:var(--theme--border-radius)' }, () =>
                        results.value.length
                            ? results.value.map((item) => h(VListItem, { key: item.id, clickable: true, onClick: () => choose(item) }, () => [
                                h(VIcon, { name: words.icon, small: true, style: 'margin-right:8px' }),
                                h(VListItemContent, () => item.name),
                            ]))
                            : h(VListItem, () => words.empty)),
                    error.value && h(VNotice, { type: 'danger', style: 'margin-top:8px' }, () => error.value),
                ]);
            };
        },
    },
};
