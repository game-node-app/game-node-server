const { mediaReference } = require('./blog-media.cjs') as { mediaReference: (source: string, cmsUrl: string) => { id: string; query: string; name: string } | null };

describe('CMS media references', () => {
    it('normalizes editorial image transformations without exposing credentials', () => {
        const id = 'abc12345-0000-4000-8000-0123456789ab';
        const media = mediaReference(`/assets/${id}?height=200&width=300`, 'https://cms.example');
        expect(media).toMatchObject({ id, query: 'format=webp&height=200&width=300' });
        expect(media?.name).toMatch(/^[a-f0-9]{64}\.webp$/);
        expect(mediaReference('https://other.example/image.png', 'https://cms.example')).toBeNull();
        expect(() => mediaReference(`/assets/${id}?access_token=secret`, 'https://cms.example')).toThrow();
    });
});
