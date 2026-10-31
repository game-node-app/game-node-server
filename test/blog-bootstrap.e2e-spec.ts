import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const fixtureDatabase = process.env.BLOG_BOOTSTRAP_TEST_DB;

(fixtureDatabase ? describe : describe.skip)('full application bootstrap', () => {
    it('starts and exposes the CMS-backed blog contract', () => {
        if (!fixtureDatabase?.startsWith('blog_openapi_')) throw new Error('Bootstrap test requires an isolated blog_openapi_ database');
        const redis = process.env.BLOG_BOOTSTRAP_TEST_REDIS;
        if (!redis || !['localhost', '127.0.0.1'].includes(new URL(redis).hostname) || !new URL(redis).port || new URL(redis).port === '6379') {
            throw new Error('Bootstrap test requires isolated loopback Redis');
        }
        const output = execFileSync(process.execPath, [join(__dirname, 'blog-bootstrap-check.cjs')], {
            cwd: join(__dirname, '..'), timeout: 60000, encoding: 'utf8', env: {
                ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_DATABASE: fixtureDatabase,
                DB_USER: process.env.BLOG_BOOTSTRAP_TEST_DB_USER, DB_PASS: process.env.BLOG_BOOTSTRAP_TEST_DB_PASSWORD,
                REDIS_URL: redis, BULLMQ_REDIS_URL: redis, BETTER_AUTH_SECRET: 'bootstrap-test-secret-'.padEnd(32, 'x'),
                PLAYER_DATA_SYNC_ENABLED: 'false', CONNECTION_CREDENTIAL_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
            },
        });
        expect(output).toContain('PASS: full application bootstrap and blog OpenAPI');
    }, 70000);
});
