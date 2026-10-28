import { sanitizeBlogHtml } from './blog-html';
import fixture from './fixtures/directus-html.json';

describe('blog HTML', () => {
    it('retains editorial formatting and removes executable content', () => {
        const html = sanitizeBlogHtml(fixture.content);
        expect(html).toContain('<h2>Olá</h2>');
        expect(html).toContain('<strong>world</strong>');
        expect(html).toContain('<a href="https://example.com">good</a>');
        expect(html).toContain('<img src="https://example.com/img.png" alt="capa" />');
        expect(html).not.toMatch(/script|onclick|onerror|javascript/i);
    });
});
