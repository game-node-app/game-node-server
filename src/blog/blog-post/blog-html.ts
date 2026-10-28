import sanitizeHtml from 'sanitize-html';

export function sanitizeBlogHtml(html: string, media: (source: string) => string = (source) => source): string {
    return sanitizeHtml(html, {
        allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'strong', 'em', 's', 'u', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'code', 'pre', 'hr'],
        allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'] },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowedSchemesByTag: { img: ['http', 'https'] },
        allowProtocolRelative: false,
        transformTags: { img: (_tag, attributes) => ({ tagName: 'img', attribs: { ...attributes, ...(attributes.src ? { src: media(attributes.src) } : {}) } }) },
    });
}
