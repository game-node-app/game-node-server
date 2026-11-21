import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AuthGuard } from '../../auth/auth.guard';
import { BlogMediaController } from './blog-media.controller';

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

describe('BlogMediaController', () => {
    it('serves content-addressed WebP files with immutable caching and leaves missing files uncached', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'blog-media-'));
        const previousRoot = process.env.BLOG_PUBLIC_MEDIA_PATH;
        const hashName = 'a'.repeat(64) + '.webp';
        process.env.BLOG_PUBLIC_MEDIA_PATH = directory;
        await writeFile(join(directory, hashName), 'webp-bytes');
        const module = await Test.createTestingModule({ controllers: [BlogMediaController] })
            .overrideGuard(AuthGuard)
            .useValue({ canActivate: () => true })
            .compile();
        const app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
        try {
            const ok = await request(app.getHttpServer()).get(`/v1/blog/media/${hashName}`).expect(200);
            expect(ok.headers['content-type']).toMatch(/^image\/webp/);
            expect(ok.headers['cache-control']).toBe('public, max-age=31536000, immutable');
            const missing = await request(app.getHttpServer()).get(`/v1/blog/media/${'b'.repeat(64)}.webp`).expect(404);
            expect(missing.headers['cache-control']).toBeUndefined();
            await request(app.getHttpServer()).get('/v1/blog/media/not-a-hash.webp').expect(404);
        } finally {
            await app.close();
            if (previousRoot === undefined) delete process.env.BLOG_PUBLIC_MEDIA_PATH;
            else process.env.BLOG_PUBLIC_MEDIA_PATH = previousRoot;
            await rm(directory, { recursive: true, force: true });
        }
    });
});
