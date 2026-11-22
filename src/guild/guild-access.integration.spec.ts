import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    CanActivate,
    Controller,
    ExecutionContext,
    Get,
    INestApplication,
    Injectable,
    Req,
    UseGuards,
    VersioningType,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { createConnection, Connection } from "mysql2/promise";
import request from "supertest";
import { Public } from "../auth/public.decorator";
import { BillingService } from "../billing/billing.service";
import { createBaselineTables } from "../../test/baseline-schema";
import { testEnvironment } from "../../test/igdb/helpers/test-environment";
import { AddAdventurersGuild1795900000000 } from "../migrations/1795900000000-AddAdventurersGuild";
import { BypassGuildAccess, GuildAccessGuard } from "./guild-access.guard";
import { GuildAccessService, GuildAccessSession } from "./guild-access.service";

// Test container credentials from test/igdb/docker-compose.yml; the fixture user only owns igdb_sync_test.
const ADMIN = { user: "root", password: "igdb-test-root" };
const DATABASE = `guild_access_test_${randomUUID().slice(0, 8)}`;

const ACHIEVEMENT_TABLES = [
    "CREATE TABLE `achievement_definition` (" +
        "`id` varchar(36) NOT NULL, `name` varchar(255) NOT NULL, " +
        "`description` varchar(500) NOT NULL, `category` int NOT NULL DEFAULT 0, " +
        "`metric` varchar(64) NOT NULL, `criteria` json NOT NULL, `icon` json NOT NULL, " +
        "`isHidden` tinyint NOT NULL DEFAULT 0, `status` varchar(16) NOT NULL DEFAULT 'published', " +
        "`publishedAt` datetime NULL DEFAULT NULL, " +
        "`createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), " +
        "`updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (`id`))",
    "CREATE TABLE `achievement_tier` (" +
        "`id` int NOT NULL AUTO_INCREMENT, `definitionId` varchar(36) NOT NULL, " +
        "`level` int NOT NULL, `threshold` int NOT NULL, `expReward` int NOT NULL, " +
        "`obtainedCount` int NOT NULL DEFAULT 0, PRIMARY KEY (`id`))",
];

interface TestRequest {
    session?: GuildAccessSession;
}

/** Stands in for AuthGuard: it attaches the same `request.session` for protected and public routes. */
@Injectable()
class TestSessionGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const userId = req.headers["x-test-user"];
        if (typeof userId === "string" && userId) {
            req.session = {
                user: {
                    id: userId,
                    role: req.headers["x-test-role"] ?? "user",
                },
                getUserId: () => userId,
            };
        }
        return true;
    }
}

@Controller("guild")
@UseGuards(TestSessionGuard, GuildAccessGuard)
class GuildAccessTestController {
    constructor(
        private readonly access: GuildAccessService,
        private readonly dataSource: DataSource,
    ) {}

    @Get("access")
    @Public()
    @BypassGuildAccess()
    accessStatus(@Req() req: TestRequest) {
        return this.access.getAccessStatus(req.session);
    }

    /** Stands in for GuildProfileService lazy initialization. */
    @Get()
    async overview(@Req() req: TestRequest) {
        await this.dataSource.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [req.session?.user?.id],
        );
        return { ok: true };
    }
}

type BillingMock = { isSupporter: jest.Mock<Promise<boolean>, [string]> };

function billingWith(
    supporters: () => Iterable<string> = () => [],
): BillingMock {
    return {
        isSupporter: jest.fn(async (userId) => {
            return [...supporters()].includes(userId);
        }),
    };
}

describe("Guild early-access gate (integration)", () => {
    let source: DataSource;
    let admin: Connection;

    const createApp = async (
        mode: string | undefined,
        billing: BillingMock,
    ): Promise<INestApplication> => {
        const service = new GuildAccessService(
            new ConfigService(
                mode === undefined ? {} : { GUILD_ACCESS_MODE: mode },
            ),
            billing as unknown as BillingService,
        );
        const moduleRef = await Test.createTestingModule({
            controllers: [GuildAccessTestController],
            providers: [
                { provide: DataSource, useValue: source },
                { provide: GuildAccessService, useValue: service },
                GuildAccessGuard,
            ],
        }).compile();
        const app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        await app.init();
        return app;
    };

    const createProfile = (userId: string) =>
        source.query("INSERT INTO profile (userId, username) VALUES (?, ?)", [
            userId,
            `guild_${userId.slice(0, 8)}`,
        ]);

    const seedMember = async (userId: string) => {
        await source.query(
            "INSERT INTO profile (userId, username, guildTitleKey, guildFrameKey) VALUES (?, ?, ?, ?)",
            [
                userId,
                `guild_${userId.slice(0, 8)}`,
                "title_chronist",
                "frame_parchment_seal",
            ],
        );
        await source.query(
            "INSERT INTO guild_profile (profileUserId, xp, `rank`) VALUES (?, 1240, 'C')",
            [userId],
        );
        await source.query(
            "INSERT INTO guild_contract (id, profileUserId, category, `rank`, xpReward, objectiveType, criteria, acceptedAt) VALUES (?, ?, 'weekly', 'C', 120, 'finish_game', '{}', NOW(6))",
            [randomUUID(), userId],
        );
    };

    const guildProfileOf = async (userId: string) =>
        (
            await source.query(
                "SELECT profileUserId, xp, `rank` FROM guild_profile WHERE profileUserId = ?",
                [userId],
            )
        )[0] ?? null;

    const contractCount = async (userId: string) =>
        Number(
            (
                await source.query(
                    "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ?",
                    [userId],
                )
            )[0].total,
        );

    const cosmeticsOf = async (userId: string) =>
        (
            await source.query(
                "SELECT guildTitleKey, guildFrameKey FROM profile WHERE userId = ?",
                [userId],
            )
        )[0];

    beforeAll(async () => {
        const mysql = testEnvironment(process.env).mysql;
        admin = await createConnection({
            host: mysql.host,
            port: mysql.port,
            ...ADMIN,
        });
        await admin.query(
            `CREATE DATABASE \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
        );
        source = await new DataSource({
            type: "mysql",
            host: mysql.host,
            port: mysql.port,
            username: ADMIN.user,
            password: ADMIN.password,
            database: DATABASE,
            timezone: "Z",
            entities: [],
            synchronize: false,
        }).initialize();
        await createBaselineTables(source, ["profile", "game"]);
        for (const statement of ACHIEVEMENT_TABLES)
            await source.query(statement);
        const runner = source.createQueryRunner();
        try {
            await new AddAdventurersGuild1795900000000().up(runner);
        } finally {
            await runner.release();
        }
    }, 120000);

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin) {
            await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
            await admin.end();
        }
    });

    describe("configuration", () => {
        const billing = billingWith();
        const serviceFor = (value?: string) =>
            new GuildAccessService(
                new ConfigService(
                    value === undefined ? {} : { GUILD_ACCESS_MODE: value },
                ),
                billing as unknown as BillingService,
            );

        it("defaults to public when GUILD_ACCESS_MODE is absent or blank", () => {
            expect(serviceFor().getMode()).toBe("public");
            expect(serviceFor("").getMode()).toBe("public");
            expect(serviceFor("   ").getMode()).toBe("public");
        });

        it("normalizes case and surrounding whitespace", () => {
            expect(serviceFor(" Supporters ").getMode()).toBe("supporters");
        });

        it("fails fast on an invalid non-empty value", () => {
            expect(() => serviceFor("beta")).toThrow(
                'Invalid GUILD_ACCESS_MODE "beta"',
            );
        });
    });

    describe("public mode", () => {
        let app: INestApplication;
        let billing: BillingMock;

        beforeAll(async () => {
            billing = billingWith();
            app = await createApp("public", billing);
        });

        afterAll(() => app?.close());

        it("allows a regular user without billing lookups", async () => {
            const userId = randomUUID();
            await createProfile(userId);

            await request(app.getHttpServer())
                .get("/v1/guild")
                .set("x-test-user", userId)
                .expect(200);

            expect(billing.isSupporter).not.toHaveBeenCalled();
            expect(await guildProfileOf(userId)).toMatchObject({
                xp: 0,
                rank: "E",
            });
        });

        it("reports access for a signed-in free user without billing lookups", async () => {
            const userId = randomUUID();
            await createProfile(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild/access")
                .set("x-test-user", userId)
                .expect(200);

            expect(response.body).toEqual({
                mode: "public",
                hasAccess: true,
            });
            expect(billing.isSupporter).not.toHaveBeenCalled();
            expect(await guildProfileOf(userId)).toBeNull();
        });
    });

    describe("supporters mode", () => {
        let app: INestApplication;
        let billing: BillingMock;
        const supporters = new Set<string>();

        beforeAll(async () => {
            billing = billingWith(() => supporters);
            app = await createApp("supporters", billing);
        });

        afterAll(() => app?.close());

        beforeEach(() => {
            billing.isSupporter.mockClear();
        });

        it("allows an active supporter after a billing lookup", async () => {
            const userId = randomUUID();
            await createProfile(userId);
            supporters.add(userId);

            await request(app.getHttpServer())
                .get("/v1/guild")
                .set("x-test-user", userId)
                .expect(200);

            expect(billing.isSupporter).toHaveBeenCalledWith(userId);
            expect(await guildProfileOf(userId)).toMatchObject({
                xp: 0,
                rank: "E",
            });
        });

        it.each(["admin", "editor"])(
            "allows %s without billing lookups",
            async (role) => {
                const userId = randomUUID();
                await createProfile(userId);

                await request(app.getHttpServer())
                    .get("/v1/guild")
                    .set("x-test-user", userId)
                    .set("x-test-role", role)
                    .expect(200);

                expect(billing.isSupporter).not.toHaveBeenCalled();
                expect(await guildProfileOf(userId)).not.toBeNull();
            },
        );

        it("blocks a regular user without creating a guild_profile", async () => {
            const userId = randomUUID();
            await createProfile(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild")
                .set("x-test-user", userId)
                .expect(403);

            expect(response.body).toEqual({
                message:
                    "Adventurers Guild is currently in early access for supporters.",
                code: "guild_early_access_required",
            });
            expect(billing.isSupporter).toHaveBeenCalledWith(userId);
            expect(await guildProfileOf(userId)).toBeNull();
        });

        it("blocks a lapsed supporter while preserving Guild and cosmetic data", async () => {
            const userId = randomUUID();
            await seedMember(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild")
                .set("x-test-user", userId)
                .expect(403);

            expect(response.body.code).toBe("guild_early_access_required");
            expect(await guildProfileOf(userId)).toMatchObject({
                xp: 1240,
                rank: "C",
            });
            expect(await contractCount(userId)).toBe(1);
            expect(await cosmeticsOf(userId)).toEqual({
                guildTitleKey: "title_chronist",
                guildFrameKey: "frame_parchment_seal",
            });
        });

        it("reports access for a guest without a guild_profile", async () => {
            const response = await request(app.getHttpServer())
                .get("/v1/guild/access")
                .expect(200);

            expect(response.body).toEqual({
                mode: "supporters",
                hasAccess: false,
            });
            expect(billing.isSupporter).not.toHaveBeenCalled();
        });

        it("reports no access for a signed-in free user without a guild_profile", async () => {
            const userId = randomUUID();
            await createProfile(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild/access")
                .set("x-test-user", userId)
                .expect(200);

            expect(response.body).toEqual({
                mode: "supporters",
                hasAccess: false,
            });
            expect(billing.isSupporter).toHaveBeenCalledWith(userId);
            expect(await guildProfileOf(userId)).toBeNull();
        });

        it("reports access for a supporter without a guild_profile", async () => {
            const userId = randomUUID();
            await createProfile(userId);
            supporters.add(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild/access")
                .set("x-test-user", userId)
                .expect(200);

            expect(response.body).toEqual({
                mode: "supporters",
                hasAccess: true,
            });
            expect(await guildProfileOf(userId)).toBeNull();
        });

        it("reports access for an editor without billing lookups", async () => {
            const userId = randomUUID();
            await createProfile(userId);

            const response = await request(app.getHttpServer())
                .get("/v1/guild/access")
                .set("x-test-user", userId)
                .set("x-test-role", "editor")
                .expect(200);

            expect(response.body).toEqual({
                mode: "supporters",
                hasAccess: true,
            });
            expect(billing.isSupporter).not.toHaveBeenCalled();
            expect(await guildProfileOf(userId)).toBeNull();
        });
    });
});
