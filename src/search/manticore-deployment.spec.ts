import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");
const TEMPLATE_PATH = path.join(
    REPO_ROOT,
    "docker/manticore/manticore.conf.template",
);
const ENTRYPOINT_PATH = path.join(REPO_ROOT, "docker/manticore/entrypoint.sh");

describe("Manticore 29.9.0 config, template rendering, and Compose definitions (3.1)", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manticore-cfg-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("renders manticore.conf from template with escaped # and \\ in DB_PASS without shell evaluation", () => {
        const outPath = path.join(tmpDir, "manticore.conf");

        execFileSync("/bin/bash", [ENTRYPOINT_PATH], {
            env: {
                PATH: process.env.PATH,
                MANTICORE_RENDER_ONLY: "1",
                MANTICORE_TEMPLATE_PATH: TEMPLATE_PATH,
                MANTICORE_CONFIG_PATH: outPath,
                DB_HOST: "server-db",
                DB_PORT: "3306",
                DB_USER: "gamenode_user",
                DB_PASS: "p@ss#word\\with$dollar`tick",
                DB_DATABASE: "gamenode",
            },
        });

        const rendered = fs.readFileSync(outPath, "utf8");
        expect(rendered).toContain("sql_host         = server-db");
        expect(rendered).toContain("sql_port         = 3306");
        expect(rendered).toContain("sql_user         = gamenode_user");
        expect(rendered).toContain(
            "sql_pass         = p@ss\\#word\\\\with$dollar`tick",
        );
        expect(rendered).toContain("sql_db           = gamenode");
        expect(rendered).not.toContain("{{DB_");
        expect(rendered).toContain("min_infix_len      = 3");
        expect(rendered).toContain("index_exact_words  = 1");
        expect(rendered).toContain("expand_keywords    = 1");
        expect(rendered).toContain(
            "sql_attr_multi     = bigint genre_ids from query; SELECT gameId, gameGenreId FROM game_genres_game_genre",
        );
        expect(rendered).toContain(
            "sql_attr_multi     = bigint theme_ids from query; SELECT gameId, gameThemeId FROM game_themes_game_theme",
        );
        expect(rendered).toContain(
            "sql_attr_multi     = bigint platform_ids from query; SELECT gameId, gamePlatformId FROM game_platform_games_game",
        );
    });

    it.each([
        ["missing DB_HOST", { DB_HOST: "" }],
        ["missing DB_USER", { DB_USER: "" }],
        ["missing DB_PASS", { DB_PASS: "" }],
        ["missing DB_DATABASE", { DB_DATABASE: "" }],
        ["unsafe DB_HOST with space", { DB_HOST: "db host" }],
        ["unsafe DB_HOST with #", { DB_HOST: "db#inject" }],
        ["unsafe DB_USER with semicolon", { DB_USER: "user;drop" }],
        ["unsafe DB_DATABASE with slash", { DB_DATABASE: "db/name" }],
        ["non-numeric DB_PORT", { DB_PORT: "abc" }],
        ["out-of-range DB_PORT (70000)", { DB_PORT: "70000" }],
        ["newline in DB_PASS", { DB_PASS: "line1\nline2" }],
        ["leading space in DB_PASS", { DB_PASS: " secret" }],
        ["trailing space in DB_PASS", { DB_PASS: "secret " }],
        ["control character in DB_PASS", { DB_PASS: "sec\x07ret" }],
    ])(
        "fails fast when rendering config with invalid input (%s)",
        (_label, overrides) => {
            const outPath = path.join(tmpDir, "manticore.conf");
            expect(() =>
                execFileSync("/bin/bash", [ENTRYPOINT_PATH], {
                    stdio: "pipe",
                    env: {
                        PATH: process.env.PATH,
                        MANTICORE_RENDER_ONLY: "1",
                        MANTICORE_TEMPLATE_PATH: TEMPLATE_PATH,
                        MANTICORE_CONFIG_PATH: outPath,
                        DB_HOST: "db",
                        DB_PORT: "3306",
                        DB_USER: "gamenode",
                        DB_PASS: "gamenode",
                        DB_DATABASE: "gamenode",
                        ...overrides,
                    },
                }),
            ).toThrow();
            expect(fs.existsSync(outPath)).toBe(false);
        },
    );

    it("validates development and production Compose definitions, loopback bindings, private prod networking, and .env.example", () => {
        const envExample = fs.readFileSync(
            path.join(REPO_ROOT, ".env.example"),
            "utf8",
        );
        expect(envExample).toContain("MANTICORE_URL=http://localhost:9308");

        const devConfigJson = execFileSync(
            "docker",
            [
                "compose",
                "-f",
                "docker-compose.yml",
                "config",
                "--format",
                "json",
            ],
            { cwd: REPO_ROOT, encoding: "utf8" },
        );
        const devConfig = JSON.parse(devConfigJson);
        const devManticore = devConfig.services.manticore;
        expect(devManticore).toBeDefined();
        expect(devManticore.image).toBe("manticoresearch/manticore:29.9.0");
        expect(devManticore.environment.CREATE_PLAIN_TABLES).toBe(
            "games:0 3 * * *;users:0 * * * *;games;users",
        );
        expect(devManticore.environment.TZ).toBe("UTC");
        expect(devManticore.ports).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    host_ip: "127.0.0.1",
                    published: "9306",
                    target: 9306,
                }),
                expect.objectContaining({
                    host_ip: "127.0.0.1",
                    published: "9308",
                    target: 9308,
                }),
            ]),
        );

        const prodRaw = fs.readFileSync(
            path.join(REPO_ROOT, "docker-compose.prod.yml"),
            "utf8",
        );
        expect(prodRaw).toContain("DB_USER: ${DB_USER}");
        expect(prodRaw).toContain("DB_PASS: ${DB_PASS}");

        const prodConfigJson = execFileSync(
            "docker",
            [
                "compose",
                "-f",
                "docker-compose.prod.yml",
                "config",
                "--format",
                "json",
            ],
            {
                cwd: REPO_ROOT,
                encoding: "utf8",
                env: {
                    ...process.env,
                    DB_USER: "prod_db_user_from_env",
                    DB_PASS: "prod_db_pass_from_env",
                    DB_HOST: "managed-mysql-uuid",
                    CONNECTION_CREDENTIAL_ENCRYPTION_KEY: "test_connection_key",
                    SUPERTOKENS_DB_USER: "st_user",
                    SUPERTOKENS_DB_PASS: "st_pass",
                    CMS_DB_PASSWORD: "cms_db_pass",
                    CMS_SECRET: "cms_test_secret",
                    CMS_LICENSE_KEY: "cms_test_license",
                    CMS_ADMIN_EMAIL: "editor@example.com",
                    CMS_ADMIN_PASSWORD: "cms_test_password",
                    BLOG_CMS_PUBLIC_URL: "https://cms.example.com",
                    BLOG_CMS_PREVIEW_TOKEN: "cms_test_preview_token",
                },
            },
        );
        const prodConfig = JSON.parse(prodConfigJson);
        expect(prodConfig.services.redis_bullmq.volumes[0].target).toBe(
            "/data",
        );
        expect(
            prodConfig.services.server.environment.SUPERTOKENS_CORE_URI,
        ).toBe("http://supertokens:3567");
        expect(prodConfig.services.server.deploy.replicas).toBe(1);
        expect(
            prodConfig.services.server.depends_on.server_migration.condition,
        ).toBe("service_completed_successfully");
        expect(prodConfig.services.server_migration.restart).toBe("no");
        const prodManticore = prodConfig.services.manticore;
        expect(prodManticore).toBeDefined();
        expect(prodManticore.image).toBe("manticoresearch/manticore:29.9.0");
        expect(prodManticore.ports).toBeUndefined();
        expect(prodManticore.environment.DB_HOST).toBe("managed-mysql-uuid");
        expect(prodManticore.environment.DB_USER).toBe("prod_db_user_from_env");
        expect(prodManticore.environment.DB_PASS).toBe("prod_db_pass_from_env");
        expect(prodManticore.deploy?.replicas).toBe(1);
        expect(Object.keys(prodManticore.networks).sort()).toEqual([
            "game_node_app",
            "gamenode",
        ]);
        expect(prodConfig.services.server.environment.MANTICORE_URL).toBe(
            "http://manticore:9308",
        );
        expect(prodConfig.volumes.manticore).toBeDefined();

        // Production MySQL is the Coolify-managed resource, reached on the dedicated gamenode network.
        expect(
            Object.values(prodConfig.services).filter((service: any) =>
                service.image.startsWith("mysql:"),
            ),
        ).toHaveLength(0);
        expect(prodConfig.networks.gamenode.external).toBe(true);
        // Only the Coolify proxy exposes services, through configured domains.
        expect(
            Object.values(prodConfig.services).filter(
                (service: any) => service.ports,
            ),
        ).toHaveLength(0);
        for (const name of [
            "server",
            "server_migration",
            "supertokens",
            "cms",
            "manticore",
        ]) {
            const service = prodConfig.services[name];
            expect(
                service.environment.DB_HOST ?? service.environment.MYSQL_HOST,
            ).toBe("managed-mysql-uuid");
            expect(Object.keys(service.networks)).toContain("gamenode");
        }
        expect(prodConfig.services.cms.environment.DB_DATABASE).toBe(
            "blog_cms",
        );
        expect(prodConfig.services.cms.environment.DB_USER).not.toBe(
            prodConfig.services.server.environment.DB_USER,
        );
        expect(
            prodConfig.services.server.depends_on["cms-media-init"].condition,
        ).toBe("service_completed_successfully");
        expect(prodConfig.volumes["blog-cms-public"].external).not.toBe(true);
        const publicMedia = prodConfig.services.cms.volumes.find(
            (volume: any) => volume.target === "/directus/public-media",
        );
        expect(publicMedia.source).toBe(
            prodConfig.services.server.volumes.find(
                (volume: any) =>
                    volume.target === "/app/blog-public-media" &&
                    volume.read_only,
            ).source,
        );
        expect(
            prodConfig.services.cms.volumes.find(
                (volume: any) => volume.target === "/directus/uploads",
            ).source,
        ).not.toBe(publicMedia.source);
    });
});
