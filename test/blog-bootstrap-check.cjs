require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { VersioningType } = require('@nestjs/common');
const { DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { initializeTransactionalContext, StorageDriver } = require('typeorm-transactional');
const mysql = require('mysql2/promise');

(async () => {
    const redis = new URL(process.env.BULLMQ_REDIS_URL);
    if (!process.env.DB_DATABASE?.startsWith('blog_openapi_') || !['localhost', '127.0.0.1'].includes(redis.hostname) || !redis.port || redis.port === '6379') {
        throw new Error('Bootstrap test requires an isolated database and Redis');
    }
    const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_DATABASE });
    try {
        await db.query("INSERT INTO igdb_catalog_state (id,status,nextEligibleAt) VALUES (1,'completed','2099-01-01') ON DUPLICATE KEY UPDATE status='completed', nextEligibleAt='2099-01-01'");
    } finally { await db.end(); }
    const { AppModule } = require('../dist/src/app.module.js');
    initializeTransactionalContext({ storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE });
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    try {
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
        const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('GameNode').setVersion('1').build());
        if (!document.paths['/v1/blog/post/{postId}']?.get || !document.paths['/v1/blog/preview/{postId}']?.get || document.paths['/v1/blog/post']?.post) {
            throw new Error('Unexpected blog OpenAPI contract');
        }
        console.log('PASS: full application bootstrap and blog OpenAPI');
    } finally { await app.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
