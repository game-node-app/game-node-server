import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import request from 'supertest';
import supertokens from 'supertokens-node';
import Session from 'supertokens-node/recipe/session';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BlogPostController } from '../../src/blog/blog-post/blog-post.controller';
import { BlogMediaController } from '../../src/blog/blog-post/blog-media.controller';
import { BlogCmsService } from '../../src/blog/blog-post/blog-cms.service';
import { BlogDeliveryService } from '../../src/blog/blog-post/blog-delivery.service';
import { BlogPresentationService } from '../../src/blog/blog-post/blog-presentation.service';

@Module({ imports: [HttpModule], controllers: [BlogPostController, BlogMediaController], providers: [BlogCmsService, BlogDeliveryService, BlogPresentationService] })
class SmokeModule {}

async function main() {
    const dir = await mkdtemp(join(tmpdir(), 'blog-cms-smoke-'));
    let app: INestApplication | undefined;
    try {
        const names: string[] = JSON.parse(process.env.CMS_TEST_MEDIA_NAMES!);
        for (const name of names) {
            if (!/^[a-f0-9]{64}\.webp$/.test(name)) throw new Error('Invalid test media filename');
            execFileSync('docker', ['cp', `${process.env.CMS_CONTAINER}:/directus/public-media/${name}`, join(dir, name)]);
        }
        process.env.BLOG_CMS_URL = process.env.CMS_URL;
        process.env.BLOG_CMS_PUBLIC_URL = process.env.CMS_URL;
        process.env.BLOG_PUBLIC_MEDIA_PATH = dir;
        process.env.DOMAIN_API = 'http://localhost:5000';
        supertokens.init({ appInfo: { appName: 'Blog smoke', apiDomain: 'http://localhost:5000', websiteDomain: 'http://localhost:3000', apiBasePath: '/v1/auth', websiteBasePath: '/auth' },
            supertokens: { connectionURI: process.env.SUPERTOKENS_CORE_URI || 'http://localhost:3567' }, recipeList: [Session.init()] });
        const module = await Test.createTestingModule({ imports: [SmokeModule] }).compile();
        app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
        await app.init();
        const result = await request(app.getHttpServer()).get(`/v1/blog/post/${process.env.CMS_TEST_ARTICLE_ID}?locale=pt-BR`).expect(200);
        if (result.body.resolvedLocale !== 'en' || result.body.title !== 'Title' || !result.body.content.includes('/v1/blog/media/')) throw new Error('CMS fallback or inline media failed');
        const coverUrl = new URL(result.body.cover.url);
        await request(app.getHttpServer()).get(coverUrl.pathname).expect(200).expect('Content-Type', /image\/webp/);
        const inline = result.body.content.match(/src="([^"]+)"/);
        if (!inline) throw new Error('Inline media URL missing');
        await request(app.getHttpServer()).get(new URL(inline[1]).pathname).expect(200).expect('Content-Type', /image\/webp/);
        console.log('PASS: real CMS published fallback, cover and inline media through the public API');
    } finally {
        if (app) await app.close();
        await rm(dir, { recursive: true, force: true });
    }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
