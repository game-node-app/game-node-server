import { h, ref } from 'vue';
import { useApi } from '@directus/extensions-sdk';

export default {
    id: 'blog-game-picker', name: 'GameNode game', icon: 'sports_esports',
    description: 'Search the GameNode catalog for a review game.', types: ['string'],
    component: {
        props: { value: String, disabled: Boolean },
        emits: ['input'],
        setup(props, { emit }) {
            const api = useApi();
            const query = ref('');
            const results = ref([]);
            const error = ref('');
            const loading = ref(false);
            async function search() {
                loading.value = true;
                error.value = '';
                try {
                    results.value = (await api.get('/blog-game-search', { params: { q: query.value } })).data.data;
                } catch {
                    results.value = [];
                    error.value = 'Game search failed. Try again.';
                } finally { loading.value = false; }
            }
            return () => h('div', [
                h('label', { for: 'blog-game-query' }, 'Search GameNode games'),
                h('input', { id: 'blog-game-query', value: query.value, disabled: props.disabled, onInput: (event) => { query.value = event.target.value; }, onKeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); search(); } } }),
                h('button', { type: 'button', disabled: props.disabled || loading.value || !query.value.trim(), onClick: search }, loading.value ? 'Searching…' : 'Search'),
                h('select', { 'aria-label': 'Review game', disabled: props.disabled, value: props.value ?? '', onChange: (event) => emit('input', event.target.value || null) }, [
                    h('option', { value: '' }, 'No game'),
                    ...(props.value && !results.value.some((game) => String(game.id) === props.value) ? [h('option', { value: props.value }, `Game ${props.value}`)] : []),
                    ...results.value.map((game) => h('option', { value: String(game.id), key: game.id }, game.name)),
                ]),
                error.value && h('p', { role: 'alert' }, error.value),
            ]);
        },
    },
};
