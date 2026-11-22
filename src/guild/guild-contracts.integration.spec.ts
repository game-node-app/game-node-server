import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    BadRequestException,
    CanActivate,
    ConflictException,
    ExecutionContext,
    INestApplication,
    Injectable,
    NotFoundException,
    VersioningType,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { AuthGuard } from "../auth/auth.guard";
import { BillingService } from "../billing/billing.service";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { Profile } from "../profile/entities/profile.entity";
import { YearGoal } from "../recap/entity/year-goal.entity";
import { RecapGoalsService } from "../recap/recap-goals.service";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";
import { GuildBoardEntry } from "./entities/guild-board-entry.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildAccessGuard } from "./guild-access.guard";
import { GuildAccessService } from "./guild-access.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractsService } from "./guild-contracts.service";
import {
    GuildCategory,
    GuildContractStatus,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRank,
    GuildRewardKind,
    LinaPose,
    LinaTrigger,
} from "./guild.constants";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { GuildController } from "./guild.controller";
import { LinaReceptionService } from "./lina-reception.service";

const NOW = new Date("2026-06-17T12:00:00Z");
const WEEK_START = "2026-06-15";
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
class TestSessionGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const userId = req.headers["x-test-user"];
        if (typeof userId === "string" && userId) {
            req.session = {
                user: { id: userId, role: "user" },
                getUserId: () => userId,
            };
        }
        return true;
    }
}

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

describe("Guild contracts (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_contracts_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let app: INestApplication;
    let profiles: GuildProfileService;
    let lina: LinaReceptionService;
    let board: GuildBoardService;
    let rewards: GuildRewardsService;
    let evaluator: GuildContractEvaluatorService;
    let contracts: GuildContractsService;
    let levelService: LevelService;
    let nextGameId = 7_100_000;
    let nextPlatformId = 7_200_000;
    let nextTaxonomyId = 7_300_000;
    const slots = new Map<string, number>();
    const getTimesToBeat = jest.fn();

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;

        const achievements = new AchievementsProgressService(
            source,
            new LevelService(source.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        levelService = new LevelService(source.getRepository(UserLevel));
        profiles = new GuildProfileService(
            source.getRepository(GuildProfile),
            source.getRepository(Profile),
            source,
            new RecapGoalsService(source.getRepository(YearGoal), source),
        );
        lina = new LinaReceptionService(source, profiles);
        const timeToBeat = new GuildTimeToBeatService(
            source.getRepository(GameTimeToBeat),
            { getTimesToBeat } as unknown as IgdbPlaytimeSyncService,
        );
        board = new GuildBoardService(source, timeToBeat);
        rewards = new GuildRewardsService(source, achievements);
        evaluator = new GuildContractEvaluatorService(source, timeToBeat);
        contracts = new GuildContractsService(
            source,
            profiles,
            board,
            rewards,
            evaluator,
            lina,
            levelService,
            achievements,
            timeToBeat,
        );

        const access = new GuildAccessService(new ConfigService({}), {
            isSupporter: jest.fn(async () => false),
        } as unknown as BillingService);
        const moduleRef = await Test.createTestingModule({
            controllers: [GuildController],
            providers: [
                { provide: GuildAccessService, useValue: access },
                { provide: GuildContractsService, useValue: contracts },
                { provide: GuildBoardService, useValue: board },
                { provide: GuildProfileService, useValue: profiles },
                { provide: GuildRewardsService, useValue: rewards },
                GuildAccessGuard,
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue(new TestSessionGuard())
            .compile();
        app = moduleRef.createNestApplication();
        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
        await db?.destroy();
    });

    beforeEach(() => {
        getTimesToBeat.mockReset();
        getTimesToBeat.mockResolvedValue([]);
    });

    async function user() {
        const userId = randomUUID();
        await source.query(
            "INSERT INTO profile (userId, username, createdAt) VALUES (?, ?, ?)",
            [
                userId,
                `u-${userId.slice(0, 8)}`,
                new Date("2025-01-02T03:04:05Z"),
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function game(name?: string) {
        const id = nextGameId++;
        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [id, name ?? `Game ${id}`, `game-${id}`],
        );
        return id;
    }

    async function entry(
        userId: string,
        gameId: number,
        values: {
            status?: CollectionEntryStatus;
            createdAt?: Date;
            plannedAt?: Date;
            startedAt?: Date;
            finishedAt?: Date;
            droppedAt?: Date;
        } = {},
    ) {
        const id = randomUUID();
        const createdAt = values.createdAt ?? new Date("2026-06-01T00:00:00Z");
        await source.query(
            `INSERT INTO collection_entry
                (id, gameId, libraryUserId, status, createdAt, plannedAt, startedAt, finishedAt, droppedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                gameId,
                userId,
                values.status ?? CollectionEntryStatus.PLANNED,
                createdAt,
                values.plannedAt ?? null,
                values.startedAt ?? null,
                values.finishedAt ?? null,
                values.droppedAt ?? null,
            ],
        );
        return id;
    }

    async function review(
        userId: string,
        gameId: number,
        collectionEntryId: string,
        createdAt: Date,
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO review
                (id, content, rating, gameId, profileUserId, collectionEntryId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                "Review",
                4,
                gameId,
                userId,
                collectionEntryId,
                createdAt,
                createdAt,
            ],
        );
        return id;
    }

    async function playtime(
        userId: string,
        gameId: number,
        totalPlaytimeSeconds: number,
        lastPlayedDate = NOW,
    ) {
        const platformId = nextPlatformId++;
        await source.query(
            "INSERT IGNORE INTO game_platform (id, name) VALUES (?, ?)",
            [platformId, "PC"],
        );
        await source.query(
            `INSERT INTO user_playtime
                (source, profileUserId, gameId, totalPlaytimeSeconds, lastPlayedDate, platformId)
             VALUES ('steam', ?, ?, ?, ?, ?)`,
            [userId, gameId, totalPlaytimeSeconds, lastPlayedDate, platformId],
        );
    }

    async function gameGenre(gameId: number) {
        const id = nextTaxonomyId++;
        await source.query("INSERT INTO game_genre (id, name) VALUES (?, ?)", [
            id,
            `Genre ${id}`,
        ]);
        await source.query(
            "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?)",
            [gameId, id],
        );
        return id;
    }

    async function gameTheme(gameId: number) {
        const id = nextTaxonomyId++;
        await source.query("INSERT INTO game_theme (id, name) VALUES (?, ?)", [
            id,
            `Theme ${id}`,
        ]);
        await source.query(
            "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?)",
            [gameId, id],
        );
        return id;
    }

    async function gameKeyword(gameId: number) {
        const id = nextTaxonomyId++;
        await source.query(
            "INSERT INTO game_keyword (id, name) VALUES (?, ?)",
            [id, `Keyword ${id}`],
        );
        await source.query(
            "INSERT INTO game_keywords_game_keyword (gameId, gameKeywordId) VALUES (?, ?)",
            [gameId, id],
        );
        return id;
    }

    async function timeToBeat(gameId: number, normallySeconds: number) {
        await source.query(
            `INSERT INTO game_time_to_beat
                (gameId, hastilySeconds, normallySeconds, completelySeconds, submitCount, fetchedAt)
             VALUES (?, NULL, ?, NULL, 10, ?)
             ON DUPLICATE KEY UPDATE normallySeconds = VALUES(normallySeconds), fetchedAt = VALUES(fetchedAt)`,
            [gameId, normallySeconds, NOW],
        );
    }

    async function makeReward(
        kind: GuildRewardKind,
        overrides: Partial<GuildReward> = {},
    ) {
        const id = randomUUID();
        return source.getRepository(GuildReward).save({
            id,
            key: `${kind}_${id.slice(0, 8)}`,
            kind,
            achievementId: null,
            inChestPool: false,
            chestBonusXp: 0,
            isActive: true,
            ...overrides,
        });
    }

    async function makeBadge() {
        const definitionId = randomUUID();
        await source.query(
            `INSERT INTO achievement_definition
                (id, name, description, category, metric, criteria, icon, isHidden, status, publishedAt)
             VALUES (?, 'Guild Badge', 'Guild Badge', 0, 'manual', '{}', '{}', 0, 'published', ?)`,
            [definitionId, NOW],
        );
        await source.query(
            "INSERT INTO achievement_tier (definitionId, level, threshold, expReward, obtainedCount) VALUES (?, 1, 1, 0, 0)",
            [definitionId],
        );
        return makeReward(GuildRewardKind.BADGE, {
            achievementId: definitionId,
        });
    }

    async function boardEntry(
        userId: string,
        overrides: {
            templateKey?: string;
            category?: GuildCategory;
            rank?: GuildRank;
            xpReward?: number;
            objectiveType?: GuildObjectiveType;
            targetCount?: number;
            criteria?: Record<string, unknown>;
            requiresTargetGame?: boolean;
            rewardId?: string | null;
            isQuick?: boolean;
            weekStart?: string;
            expiresAt?: Date;
        } = {},
    ) {
        const id = randomUUID();
        const weekStart = overrides.weekStart ?? WEEK_START;
        const slotKey = `${userId}:${weekStart}`;
        const slotIndex = slots.get(slotKey) ?? 0;
        slots.set(slotKey, slotIndex + 1);
        await source.query(
            `INSERT INTO guild_board_entry
                (id, profileUserId, weekStart, slotIndex, category, templateKey, \`rank\`, xpReward,
                 objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                 isRecommended, isQuick, expiresAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?)`,
            [
                id,
                userId,
                weekStart,
                slotIndex,
                overrides.category ?? GuildCategory.WEEKLY,
                overrides.templateKey ?? "weekend_sprint",
                overrides.rank ?? GuildRank.D,
                overrides.xpReward ?? 140,
                overrides.objectiveType ?? GuildObjectiveType.FINISH_GAME,
                overrides.targetCount ?? 1,
                JSON.stringify(overrides.criteria ?? {}),
                overrides.requiresTargetGame ?? false,
                overrides.rewardId ?? null,
                overrides.isQuick ?? true,
                overrides.expiresAt ?? new Date("2026-06-22T03:00:00.000Z"),
            ],
        );
        return source.getRepository(GuildBoardEntry).findOneByOrFail({ id });
    }

    async function event(
        overrides: {
            objectiveType?: GuildObjectiveType;
            targetCount?: number;
            criteria?: Record<string, unknown>;
            xpReward?: number;
            rewardId?: string | null;
            startsAt?: Date;
            endsAt?: Date;
            status?: GuildEventStatus;
        } = {},
    ) {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_event
                (id, slug, title, description, \`rank\`, xpReward, objectiveType, targetCount, criteria,
                 rewardId, startsAt, endsAt, status, publishedAt, createdAt, updatedAt)
             VALUES (?, ?, 'Metroidvania Month', 'Finish a Metroidvania.', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                `event-${id.slice(0, 8)}`,
                GuildRank.D,
                overrides.xpReward ?? 120,
                overrides.objectiveType ?? GuildObjectiveType.FINISH_GAME,
                overrides.targetCount ?? 1,
                JSON.stringify(overrides.criteria ?? {}),
                overrides.rewardId ?? null,
                overrides.startsAt ?? new Date(NOW.getTime() - DAY_MS),
                overrides.endsAt ?? new Date(NOW.getTime() + 7 * DAY_MS),
                overrides.status ?? GuildEventStatus.PUBLISHED,
                NOW,
                NOW,
                NOW,
            ],
        );
        return id;
    }

    async function insertContract(
        userId: string,
        values: {
            status?: GuildContractStatus;
            expiresAt?: Date | null;
            xpReward?: number;
            objectiveType?: GuildObjectiveType;
            progressCurrent?: number;
            progressTarget?: number;
            readyAt?: Date | null;
        } = {},
    ) {
        const id = randomUUID();
        const status = values.status ?? GuildContractStatus.ACTIVE;
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, boardEntryId, eventId, category, templateKey, \`rank\`, xpReward,
                 objectiveType, criteria, targetGameId, progressCurrent, progressTarget, status, rewardId,
                 claimPayload, acceptedAt, readyAt, claimedAt, expiresAt)
             VALUES (?, ?, NULL, NULL, ?, 'weekend_sprint', ?, ?, ?, '{}', NULL, ?, ?, ?, NULL,
                     NULL, ?, ?, NULL, ?)`,
            [
                id,
                userId,
                GuildCategory.WEEKLY,
                GuildRank.D,
                values.xpReward ?? 140,
                values.objectiveType ?? GuildObjectiveType.FINISH_GAME,
                values.progressCurrent ?? 0,
                values.progressTarget ?? 1,
                status,
                NOW,
                values.readyAt ??
                    (status === GuildContractStatus.READY_TO_CLAIM
                        ? NOW
                        : null),
                values.expiresAt === undefined ? null : values.expiresAt,
            ],
        );
        return id;
    }

    async function contractOf(contractId: string) {
        return source
            .getRepository(GuildContract)
            .findOneByOrFail({ id: contractId });
    }

    async function outboxFor(contractId: string) {
        const rows: Array<{ payload: unknown }> = await source.query(
            "SELECT payload FROM notification_outbox WHERE eventType = ?",
            ["guild.contract-ready"],
        );
        return rows.filter((row) => {
            const payload =
                typeof row.payload === "string"
                    ? JSON.parse(row.payload)
                    : (row.payload as Record<string, unknown>);
            return payload?.contractId === contractId;
        });
    }

    /** Accepts a deep-dive quest, finishes its target and evaluates it to ready. */
    async function readyContract(
        userId: string,
        options: {
            xpReward?: number;
            rank?: GuildRank;
            rewardId?: string | null;
        } = {},
    ) {
        const gameId = await game();
        await entry(userId, gameId, {
            status: CollectionEntryStatus.PLAYING,
        });
        const quest = await boardEntry(userId, {
            templateKey: "deep_dive",
            category: GuildCategory.LIBRARY,
            rank: options.rank ?? GuildRank.B,
            xpReward: options.xpReward ?? 250,
            requiresTargetGame: true,
            isQuick: false,
            rewardId: options.rewardId ?? null,
        });
        const { contract } = await contracts.acceptContract(
            userId,
            { boardEntryId: quest.id, targetGameId: gameId },
            NOW,
        );
        await source.query(
            "UPDATE collection_entry SET status = ?, finishedAt = ? WHERE libraryUserId = ? AND gameId = ?",
            [
                CollectionEntryStatus.FINISHED,
                new Date(NOW.getTime() + 60_000),
                userId,
                gameId,
            ],
        );
        await evaluator.evaluateUserContracts(
            userId,
            new Date(NOW.getTime() + 120_000),
        );
        return contract.id;
    }

    describe("acceptance validation", () => {
        it("requires exactly one source and a valid target for requiresTargetGame quests", async () => {
            const userId = await user();
            const gameId = await game();
            const quest = await boardEntry(userId, {
                templateKey: "forgotten_relic",
                category: GuildCategory.LIBRARY,
                rank: GuildRank.B,
                xpReward: 250,
                requiresTargetGame: true,
                isQuick: false,
            });

            await expect(
                contracts.acceptContract(userId, {}, NOW),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                contracts.acceptContract(
                    userId,
                    {
                        boardEntryId: quest.id,
                        eventId: await event(),
                        targetGameId: gameId,
                    },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
            await expect(
                contracts.acceptContract(
                    userId,
                    { boardEntryId: quest.id },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);

            // A finished game is never an eligible target.
            await entry(userId, gameId, {
                status: CollectionEntryStatus.FINISHED,
            });
            await expect(
                contracts.acceptContract(
                    userId,
                    { boardEntryId: quest.id, targetGameId: gameId },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);

            // Stale backlog game is eligible.
            const staleGameId = await game();
            await entry(userId, staleGameId, {
                status: CollectionEntryStatus.PLANNED,
                plannedAt: new Date("2024-01-01T00:00:00Z"),
            });
            const accepted = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id, targetGameId: staleGameId },
                NOW,
            );
            expect(accepted.contract.targetGameId).toBe(staleGameId);
            expect(accepted.contract.progressCurrent).toBe(0);
            expect(accepted.contract.progressTarget).toBe(1);
            expect(accepted.contract.status).toBe(GuildContractStatus.ACTIVE);
            expect(accepted.lina).toBeDefined();
        });

        it("rejects targets that do not satisfy genre, keyword and TTB criteria", async () => {
            const userId = await user();
            const matchingGame = await game();
            const genreId = await gameGenre(matchingGame);
            await timeToBeat(matchingGame, 6 * 60 * 60);

            const withoutGenre = await game();
            await timeToBeat(withoutGenre, 6 * 60 * 60);

            const finishQuest = await boardEntry(userId, {
                templateKey: "short_caravan",
                criteria: { genreIds: [genreId], maxTimeToBeatHours: 8 },
                xpReward: 150,
            });
            await expect(
                contracts.acceptContract(
                    userId,
                    {
                        boardEntryId: finishQuest.id,
                        targetGameId: withoutGenre,
                    },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);

            const tooLong = await game();
            await gameGenre(tooLong);
            await timeToBeat(tooLong, 10 * 60 * 60);
            await expect(
                contracts.acceptContract(
                    userId,
                    { boardEntryId: finishQuest.id, targetGameId: tooLong },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);

            // A cached 0s time-to-beat is not a valid short game.
            const zeroTimeToBeat = await game();
            await source.query(
                "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?)",
                [zeroTimeToBeat, genreId],
            );
            await timeToBeat(zeroTimeToBeat, 0);
            await expect(
                contracts.acceptContract(
                    userId,
                    {
                        boardEntryId: finishQuest.id,
                        targetGameId: zeroTimeToBeat,
                    },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);

            const accepted = await contracts.acceptContract(
                userId,
                { boardEntryId: finishQuest.id, targetGameId: matchingGame },
                NOW,
            );
            expect(accepted.contract.targetGameId).toBe(matchingGame);

            const keywordId = await gameKeyword(matchingGame);
            const reviewQuest = await boardEntry(userId, {
                templateKey: "on_duty_critic",
                category: GuildCategory.GAMENODE,
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                criteria: { keywordIds: [keywordId] },
                xpReward: 120,
            });
            await expect(
                contracts.acceptContract(
                    userId,
                    {
                        boardEntryId: reviewQuest.id,
                        targetGameId: withoutGenre,
                    },
                    NOW,
                ),
            ).rejects.toBeInstanceOf(BadRequestException);
            const reviewAccepted = await contracts.acceptContract(
                userId,
                { boardEntryId: reviewQuest.id, targetGameId: matchingGame },
                NOW,
            );
            expect(reviewAccepted.contract.objectiveType).toBe(
                GuildObjectiveType.WRITE_REVIEW,
            );
        });

        it("enforces the 3-contract cap under parallel accepts", async () => {
            const userId = await user();
            await insertContract(userId);
            await insertContract(userId);

            const firstQuest = await boardEntry(userId);
            const secondQuest = await boardEntry(userId);
            const results = await Promise.allSettled([
                contracts.acceptContract(
                    userId,
                    { boardEntryId: firstQuest.id },
                    NOW,
                ),
                contracts.acceptContract(
                    userId,
                    { boardEntryId: secondQuest.id },
                    NOW,
                ),
            ]);

            const fulfilled = results.filter(
                (result) => result.status === "fulfilled",
            );
            const rejected = results.filter(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected",
            );
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(ConflictException);
            expect(
                (rejected[0].reason.getResponse() as { code?: string }).code,
            ).toBe("guild_active_contract_limit_reached");

            const rows: Array<{ total: number }> = await source.query(
                "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ? AND status IN (?, ?)",
                [
                    userId,
                    GuildContractStatus.ACTIVE,
                    GuildContractStatus.READY_TO_CLAIM,
                ],
            );
            expect(Number(rows[0].total)).toBe(3);
        });

        it("rejects duplicate concurrent accepts of the same quest", async () => {
            const userId = await user();
            const quest = await boardEntry(userId);
            const [first, second] = await Promise.allSettled([
                contracts.acceptContract(
                    userId,
                    { boardEntryId: quest.id },
                    NOW,
                ),
                contracts.acceptContract(
                    userId,
                    { boardEntryId: quest.id },
                    NOW,
                ),
            ]);

            const rejected =
                first.status === "rejected"
                    ? first
                    : second.status === "rejected"
                      ? second
                      : null;
            expect(
                [first.status, second.status].filter(
                    (status) => status === "fulfilled",
                ),
            ).toHaveLength(1);
            expect(rejected?.reason).toBeInstanceOf(ConflictException);
            expect(
                (
                    (rejected?.reason as ConflictException).getResponse() as {
                        code?: string;
                    }
                ).code,
            ).toBe("guild_contract_already_exists");

            const rows: Array<{ total: number }> = await source.query(
                "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ? AND boardEntryId = ?",
                [userId, quest.id],
            );
            expect(Number(rows[0].total)).toBe(1);
        });
    });

    describe("Lina contract triggers", () => {
        it("returns the acceptance confirmation without touching lastVisitedAt", async () => {
            const userId = await user();
            await profiles.ensureProfile(userId);
            const lastVisitedAt = new Date(NOW.getTime() - 2 * DAY_MS);
            await source.query(
                "UPDATE guild_profile SET lastVisitedAt = ? WHERE profileUserId = ?",
                [lastVisitedAt, userId],
            );
            const gameId = await game();
            const quest = await boardEntry(userId, {
                category: GuildCategory.LIBRARY,
                templateKey: "weekend_sprint",
            });

            const accepted = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id, targetGameId: gameId },
                NOW,
            );

            expect(accepted.lina).toMatchObject({
                trigger: LinaTrigger.CONTRACT_ACCEPTED,
                pose: LinaPose.HAPPY,
                context: {
                    contractId: accepted.contract.id,
                    category: GuildCategory.LIBRARY,
                    templateKey: "weekend_sprint",
                    eventId: null,
                    targetGameId: gameId,
                    targetGameName: `Game ${gameId}`,
                },
            });

            const [stored] = await source.query(
                "SELECT lastVisitedAt FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(new Date(stored.lastVisitedAt).getTime()).toBe(
                lastVisitedAt.getTime(),
            );
        });

        it("returns the claim celebration context without touching lastVisitedAt", async () => {
            const userId = await user();
            await source.query(
                "INSERT INTO guild_profile (profileUserId, xp, `rank`) VALUES (?, ?, ?)",
                [userId, 100, GuildRank.E],
            );
            const contractId = await readyContract(userId, { xpReward: 250 });
            const lastVisitedAt = new Date(NOW.getTime() - 2 * DAY_MS);
            await source.query(
                "UPDATE guild_profile SET lastVisitedAt = ? WHERE profileUserId = ?",
                [lastVisitedAt, userId],
            );

            const claim = await contracts.claimContract(
                userId,
                contractId,
                NOW,
            );

            expect(claim.lina).toMatchObject({
                trigger: LinaTrigger.CONTRACT_CLAIMED,
                pose: LinaPose.HAPPY,
                context: {
                    contractId,
                    xpAwarded: 250,
                    rankBefore: GuildRank.E,
                    rankAfter: GuildRank.D,
                    rankedUp: true,
                },
            });

            const [stored] = await source.query(
                "SELECT lastVisitedAt FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(new Date(stored.lastVisitedAt).getTime()).toBe(
                lastVisitedAt.getTime(),
            );
        });
    });

    describe("post-acceptance timestamp boundary", () => {
        it("ignores finishes committed before acceptedAt and counts later ones", async () => {
            const userId = await user();
            const quest = await boardEntry(userId, { targetCount: 2 });
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id },
                NOW,
            );

            const earlyGame = await game();
            await entry(userId, earlyGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date(NOW.getTime() - 60_000),
            });
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 60_000),
            );
            expect((await contractOf(contract.id)).progressCurrent).toBe(0);
            expect((await contractOf(contract.id)).status).toBe(
                GuildContractStatus.ACTIVE,
            );

            const laterGame = await game();
            await entry(userId, laterGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date(NOW.getTime() + 5 * 60_000),
            });
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 10 * 60_000),
            );
            const updated = await contractOf(contract.id);
            expect(updated.progressCurrent).toBe(1);
            expect(updated.status).toBe(GuildContractStatus.ACTIVE);
        });
    });

    describe("evaluation", () => {
        it("moves a targeted finish contract to ready once with one outbox intent", async () => {
            const userId = await user();
            const gameId = await game();
            await entry(userId, gameId, {
                status: CollectionEntryStatus.PLAYING,
            });
            const quest = await boardEntry(userId, {
                templateKey: "deep_dive",
                category: GuildCategory.LIBRARY,
                requiresTargetGame: true,
                rank: GuildRank.C,
                xpReward: 200,
            });
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id, targetGameId: gameId },
                NOW,
            );

            await source.query(
                "UPDATE collection_entry SET status = ?, finishedAt = ? WHERE libraryUserId = ? AND gameId = ?",
                [
                    CollectionEntryStatus.FINISHED,
                    new Date(NOW.getTime() + 60_000),
                    userId,
                    gameId,
                ],
            );
            const evaluationNow = new Date(NOW.getTime() + 120_000);
            await Promise.all([
                evaluator.evaluateUserContracts(userId, evaluationNow),
                evaluator.evaluateUserContracts(userId, evaluationNow),
            ]);

            const updated = await contractOf(contract.id);
            expect(updated.status).toBe(GuildContractStatus.READY_TO_CLAIM);
            expect(updated.progressCurrent).toBe(1);
            expect(updated.readyAt).not.toBeNull();
            expect(await outboxFor(contract.id)).toHaveLength(1);

            await evaluator.evaluateUserContracts(userId, evaluationNow);
            expect(await outboxFor(contract.id)).toHaveLength(1);
        });

        it("evaluates event criteria with genres, themes, keywords and TTB", async () => {
            const userId = await user();
            const matching = await game();
            const genreId = await gameGenre(matching);
            const themeId = await gameTheme(matching);
            const keywordId = await gameKeyword(matching);
            await timeToBeat(matching, 6 * 60 * 60);

            const partial = await game();
            await gameGenre(partial);
            await timeToBeat(partial, 6 * 60 * 60);

            const tooLong = await game();
            await gameGenre(tooLong);
            await gameTheme(tooLong);
            await gameKeyword(tooLong);
            await timeToBeat(tooLong, 10 * 60 * 60);

            const zeroTimeToBeat = await game();
            await source.query(
                "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?)",
                [zeroTimeToBeat, genreId],
            );
            await source.query(
                "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?)",
                [zeroTimeToBeat, themeId],
            );
            await source.query(
                "INSERT INTO game_keywords_game_keyword (gameId, gameKeywordId) VALUES (?, ?)",
                [zeroTimeToBeat, keywordId],
            );
            await timeToBeat(zeroTimeToBeat, 0);

            const criteriaEvent = await event({
                criteria: {
                    genreIds: [genreId],
                    themeIds: [themeId],
                    keywordIds: [keywordId],
                    maxTimeToBeatHours: 8,
                },
            });
            const { contract } = await contracts.acceptContract(
                userId,
                { eventId: criteriaEvent },
                NOW,
            );

            const finishNow = new Date(NOW.getTime() + 60_000);
            for (const gameId of [partial, tooLong, zeroTimeToBeat]) {
                await entry(userId, gameId, {
                    status: CollectionEntryStatus.FINISHED,
                    finishedAt: finishNow,
                });
            }
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 120_000),
            );
            const partialProgress = await contractOf(contract.id);
            expect(partialProgress.status).toBe(GuildContractStatus.ACTIVE);
            expect(partialProgress.progressCurrent).toBe(0);

            await entry(userId, matching, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date(NOW.getTime() + 180_000),
            });
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 240_000),
            );
            const updated = await contractOf(contract.id);
            expect(updated.status).toBe(GuildContractStatus.READY_TO_CLAIM);
            expect(await outboxFor(contract.id)).toHaveLength(1);
        });

        it("evaluates reviews, including finishedInCurrentMonth, and ignores prior reviews", async () => {
            const userId = await user();
            const quest = await boardEntry(userId, {
                templateKey: "captains_log",
                category: GuildCategory.GAMENODE,
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                rank: GuildRank.E,
                xpReward: 80,
                criteria: { finishedInCurrentMonth: true },
            });
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id },
                NOW,
            );

            const priorGame = await game();
            const priorEntry = await entry(userId, priorGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date("2026-06-02T00:00:00Z"),
            });
            await review(
                userId,
                priorGame,
                priorEntry,
                new Date(NOW.getTime() - 60_000),
            );

            const lastMonthGame = await game();
            const lastMonthEntry = await entry(userId, lastMonthGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date("2026-05-10T00:00:00Z"),
            });
            await review(
                userId,
                lastMonthGame,
                lastMonthEntry,
                new Date(NOW.getTime() + 60_000),
            );
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 120_000),
            );
            expect((await contractOf(contract.id)).progressCurrent).toBe(0);
            expect((await contractOf(contract.id)).status).toBe(
                GuildContractStatus.ACTIVE,
            );

            const currentMonthGame = await game();
            const currentMonthEntry = await entry(userId, currentMonthGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date("2026-06-02T00:00:00Z"),
            });
            await review(
                userId,
                currentMonthGame,
                currentMonthEntry,
                new Date(NOW.getTime() + 180_000),
            );
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 240_000),
            );
            const updated = await contractOf(contract.id);
            expect(updated.status).toBe(GuildContractStatus.READY_TO_CLAIM);
            expect(await outboxFor(contract.id)).toHaveLength(1);
        });

        it("enriches an active game contract with live playtime progress", async () => {
            const userId = await user();
            const gameId = await game();
            await entry(userId, gameId, {
                status: CollectionEntryStatus.PLAYING,
            });
            await timeToBeat(gameId, 104_400);
            await playtime(userId, gameId, 64_800);

            const quest = await boardEntry(userId, {
                templateKey: "deep_dive",
                category: GuildCategory.LIBRARY,
                requiresTargetGame: true,
                isQuick: false,
            });
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id, targetGameId: gameId },
                NOW,
            );

            const listing = await contracts.listContracts(
                userId,
                { tab: "accepted" },
                NOW,
            );
            const listed = listing.data.find(
                (item) => item.id === contract.id,
            )!;
            expect(listed.playtimeProgress).toEqual({
                playedSeconds: 64_800,
                estimatedTotalSeconds: 104_400,
                estimatedPercent: 62,
            });
            expect(listed.targetGame).toMatchObject({ gameId });

            await source.query(
                "UPDATE user_playtime SET totalPlaytimeSeconds = ? WHERE profileUserId = ? AND gameId = ?",
                [200_000, userId, gameId],
            );
            const clamped = await contracts.listContracts(
                userId,
                { tab: "accepted" },
                NOW,
            );
            expect(
                clamped.data.find((item) => item.id === contract.id)!
                    .playtimeProgress,
            ).toEqual({
                playedSeconds: 200_000,
                estimatedTotalSeconds: 104_400,
                estimatedPercent: 99,
            });
        });
    });

    describe("non-revocation", () => {
        it("keeps a ready review contract after the review is deleted", async () => {
            const userId = await user();
            const quest = await boardEntry(userId, {
                templateKey: "on_duty_critic",
                category: GuildCategory.GAMENODE,
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                criteria: {},
            });
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id },
                NOW,
            );
            const gameId = await game();
            const entryId = await entry(userId, gameId);
            const reviewId = await review(
                userId,
                gameId,
                entryId,
                new Date(NOW.getTime() + 60_000),
            );
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 120_000),
            );
            expect((await contractOf(contract.id)).status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );

            await source.query("DELETE FROM review WHERE id = ?", [reviewId]);
            await evaluator.evaluateUserContracts(
                userId,
                new Date(NOW.getTime() + 180_000),
            );
            const updated = await contractOf(contract.id);
            expect(updated.status).toBe(GuildContractStatus.READY_TO_CLAIM);
            expect(updated.progressCurrent).toBe(1);
        });

        it("expires overdue active event contracts while ready ones stay claimable", async () => {
            const activeUser = await user();
            const readyUser = await user();
            const activeEvent = await event({
                endsAt: new Date(NOW.getTime() + 60 * 60_000),
            });
            const readyEvent = await event({
                endsAt: new Date(NOW.getTime() + 60 * 60_000),
            });

            const active = await contracts.acceptContract(
                activeUser,
                { eventId: activeEvent },
                NOW,
            );
            const ready = await contracts.acceptContract(
                readyUser,
                { eventId: readyEvent },
                NOW,
            );
            const readyGame = await game();
            await entry(readyUser, readyGame, {
                status: CollectionEntryStatus.FINISHED,
                finishedAt: new Date(NOW.getTime() + 30 * 60_000),
            });
            await evaluator.evaluateUserContracts(
                readyUser,
                new Date(NOW.getTime() + 45 * 60_000),
            );
            expect((await contractOf(ready.contract.id)).status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );

            const afterDeadline = new Date(NOW.getTime() + 2 * 60 * 60_000);
            await evaluator.evaluateUserContracts(activeUser, afterDeadline);
            await evaluator.evaluateUserContracts(readyUser, afterDeadline);

            expect((await contractOf(active.contract.id)).status).toBe(
                GuildContractStatus.EXPIRED,
            );
            expect((await contractOf(ready.contract.id)).status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );
        });
    });

    describe("claim", () => {
        it("awards Guild XP, Rank, global level and badge over HTTP 200", async () => {
            const userId = await user();
            await source.query(
                "INSERT INTO guild_profile (profileUserId, xp, `rank`) VALUES (?, ?, ?)",
                [userId, 1_900, GuildRank.C],
            );
            const badge = await makeBadge();
            const contractId = await readyContract(userId, {
                xpReward: 250,
                rewardId: badge.id,
            });

            const response = await request(app.getHttpServer())
                .post(`/v1/guild/contracts/${contractId}/claim`)
                .set("x-test-user", userId)
                .expect(200);

            expect(response.body.xpAwarded).toBe(250);
            expect(response.body.rankBefore).toBe(GuildRank.C);
            expect(response.body.rankAfter).toBe(GuildRank.B);
            expect(response.body.contract.status).toBe(
                GuildContractStatus.COMPLETED,
            );
            expect(response.body.unlockedRewards).toHaveLength(1);
            expect(response.body.lina).toBeDefined();

            const [guildProfile] = await source.query(
                "SELECT xp, `rank` FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(Number(guildProfile.xp)).toBe(2_150);
            expect(guildProfile.rank).toBe(GuildRank.B);

            const [userLevel] = await source.query(
                "SELECT currentLevel FROM user_level WHERE userId = ?",
                [userId],
            );
            expect(userLevel.currentLevel).toBeGreaterThanOrEqual(2);

            const obtained: Array<{ total: number }> = await source.query(
                "SELECT COUNT(*) AS total FROM obtained_achievement WHERE profileUserId = ? AND achievementId = ?",
                [userId, badge.achievementId],
            );
            expect(Number(obtained[0].total)).toBe(1);

            const stored = await contractOf(contractId);
            expect(stored.claimPayload).toMatchObject({
                xpAwarded: 250,
                rankBefore: GuildRank.C,
                rankAfter: GuildRank.B,
            });

            const secondClaim = await rejectionOf(
                contracts.claimContract(userId, contractId, NOW),
            );
            expect(secondClaim).toBeInstanceOf(ConflictException);
            expect((secondClaim.getResponse() as { code?: string }).code).toBe(
                "guild_contract_not_ready",
            );

            // The same badge on another contract is idempotent.
            const secondContractId = await readyContract(userId, {
                xpReward: 250,
                rewardId: badge.id,
            });
            const second = await contracts.claimContract(
                userId,
                secondContractId,
                NOW,
            );
            expect(second.unlockedRewards).toHaveLength(0);
            const [afterSecond] = await source.query(
                "SELECT xp FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(Number(afterSecond.xp)).toBe(2_400);
            const obtainedAfter: Array<{ total: number }> = await source.query(
                "SELECT COUNT(*) AS total FROM obtained_achievement WHERE profileUserId = ? AND achievementId = ?",
                [userId, badge.achievementId],
            );
            expect(Number(obtainedAfter[0].total)).toBe(1);
        });

        it("grants +50 XP when a title is already owned", async () => {
            const userId = await user();
            const title = await makeReward(GuildRewardKind.TITLE);
            await source.query(
                "INSERT INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, NULL, ?)",
                [userId, title.id, NOW],
            );
            const contractId = await readyContract(userId, {
                xpReward: 250,
                rewardId: title.id,
            });

            const claim = await contracts.claimContract(
                userId,
                contractId,
                NOW,
            );
            expect(claim.xpAwarded).toBe(300);
            expect(claim.unlockedRewards).toHaveLength(0);
            const [guildProfile] = await source.query(
                "SELECT xp FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(Number(guildProfile.xp)).toBe(300);
        });

        it("opens a weekly chest with bonus XP and a pool cosmetic", async () => {
            const userId = await user();
            const chest = await makeReward(GuildRewardKind.WEEKLY_CHEST, {
                key: "weekly_chest",
                chestBonusXp: 75,
            });
            const poolCosmetic = await makeReward(GuildRewardKind.TITLE, {
                key: "title_pool_test",
                inChestPool: true,
            });
            const contractId = await readyContract(userId, {
                xpReward: 150,
                rewardId: chest.id,
            });

            const claim = await contracts.claimContract(
                userId,
                contractId,
                NOW,
            );
            expect(claim.xpAwarded).toBe(225);
            expect(claim.chestResult).toEqual({
                bonusXp: 75,
                unlockedCosmetic: expect.objectContaining({
                    id: poolCosmetic.id,
                }),
            });
            const unlocked: Array<{ total: number }> = await source.query(
                "SELECT COUNT(*) AS total FROM user_guild_reward WHERE profileUserId = ? AND rewardId = ?",
                [userId, poolCosmetic.id],
            );
            expect(Number(unlocked[0].total)).toBe(1);
        });

        it("rejects concurrent claims so XP is credited once", async () => {
            const userId = await user();
            const contractId = await readyContract(userId, {
                xpReward: 250,
            });

            const [first, second] = await Promise.allSettled([
                contracts.claimContract(userId, contractId, NOW),
                contracts.claimContract(userId, contractId, NOW),
            ]);
            expect(
                [first.status, second.status].filter(
                    (status) => status === "fulfilled",
                ),
            ).toHaveLength(1);
            const rejected = first.status === "rejected" ? first : second;
            expect(rejected.status).toBe("rejected");
            if (rejected.status === "rejected") {
                expect(rejected.reason).toBeInstanceOf(ConflictException);
            }

            const [guildProfile] = await source.query(
                "SELECT xp FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            expect(Number(guildProfile.xp)).toBe(250);
        });

        it("rejects claiming an active contract", async () => {
            const userId = await user();
            const quest = await boardEntry(userId);
            const { contract } = await contracts.acceptContract(
                userId,
                { boardEntryId: quest.id },
                NOW,
            );
            const error = await rejectionOf(
                contracts.claimContract(userId, contract.id, NOW),
            );
            expect(error).toBeInstanceOf(ConflictException);
            expect((error.getResponse() as { code?: string }).code).toBe(
                "guild_contract_not_ready",
            );
        });
    });

    describe("abandon, expiration and listing", () => {
        it("abandons an active contract, frees its slot and rejects invalid states", async () => {
            const userId = await user();
            const quests = await Promise.all([
                boardEntry(userId),
                boardEntry(userId),
                boardEntry(userId),
            ]);
            const accepted = [];
            for (const quest of quests) {
                accepted.push(
                    (
                        await contracts.acceptContract(
                            userId,
                            { boardEntryId: quest.id },
                            NOW,
                        )
                    ).contract,
                );
            }

            const abandoned = await contracts.abandonContract(
                userId,
                accepted[0].id,
            );
            expect(abandoned.status).toBe(GuildContractStatus.ABANDONED);

            const otherUser = await user();
            const notOwned = await rejectionOf(
                contracts.abandonContract(otherUser, accepted[1].id),
            );
            expect(notOwned).toBeInstanceOf(NotFoundException);

            const notActive = await rejectionOf(
                contracts.abandonContract(userId, accepted[0].id),
            );
            expect(notActive).toBeInstanceOf(ConflictException);
            expect((notActive.getResponse() as { code?: string }).code).toBe(
                "guild_contract_not_active",
            );

            const replacement = await boardEntry(userId);
            const acceptedAgain = await contracts.acceptContract(
                userId,
                { boardEntryId: replacement.id },
                NOW,
            );
            expect(acceptedAgain.contract.status).toBe(
                GuildContractStatus.ACTIVE,
            );
        });

        it("expires overdue active contracts hourly, lazily and never ready ones", async () => {
            const hourlyUser = await user();
            const lazyUser = await user();
            const activeExpired = await insertContract(hourlyUser, {
                expiresAt: new Date(NOW.getTime() - 60 * 60_000),
            });
            const readyExpired = await insertContract(hourlyUser, {
                status: GuildContractStatus.READY_TO_CLAIM,
                expiresAt: new Date(NOW.getTime() - 60 * 60_000),
            });
            const lazyExpired = await insertContract(lazyUser, {
                expiresAt: new Date(NOW.getTime() - 60 * 60_000),
            });

            expect(await evaluator.expireOverdueContracts(undefined, NOW)).toBe(
                2,
            );
            expect((await contractOf(activeExpired)).status).toBe(
                GuildContractStatus.EXPIRED,
            );
            expect((await contractOf(lazyExpired)).status).toBe(
                GuildContractStatus.EXPIRED,
            );
            expect((await contractOf(readyExpired)).status).toBe(
                GuildContractStatus.READY_TO_CLAIM,
            );

            const anotherLazy = await insertContract(lazyUser, {
                expiresAt: new Date(NOW.getTime() - 60 * 60_000),
            });
            const listing = await contracts.listContracts(
                lazyUser,
                { tab: "accepted" },
                NOW,
            );
            expect(listing.data.some((item) => item.id === anotherLazy)).toBe(
                false,
            );
            expect((await contractOf(anotherLazy)).status).toBe(
                GuildContractStatus.EXPIRED,
            );
        });

        it("returns every contract of the user when neither tab nor status is sent", async () => {
            const userId = await user();
            const expired = await insertContract(userId, {
                status: GuildContractStatus.EXPIRED,
            });
            const abandoned = await insertContract(userId, {
                status: GuildContractStatus.ABANDONED,
            });
            const completed = await insertContract(userId, {
                status: GuildContractStatus.COMPLETED,
            });
            const ready = await insertContract(userId, {
                status: GuildContractStatus.READY_TO_CLAIM,
            });
            const active = await insertContract(userId);
            const updatedAtDesc = [expired, abandoned, completed, ready, active];
            for (const [index, id] of updatedAtDesc.entries()) {
                await source.query(
                    "UPDATE guild_contract SET updatedAt = ? WHERE id = ?",
                    [new Date(NOW.getTime() - index * 60_000), id],
                );
            }

            const all = await contracts.listContracts(userId, {}, NOW);
            expect(all.data.map((item) => item.id)).toEqual(updatedAtDesc);
            expect(all.pagination.totalItems).toBe(5);

            const acceptedTab = await contracts.listContracts(
                userId,
                { tab: "accepted" },
                NOW,
            );
            expect(acceptedTab.data.map((item) => item.id)).toEqual([
                ready,
                active,
            ]);
            expect(acceptedTab.pagination.totalItems).toBe(2);
        });

        it("lists accepted contracts over HTTP with ready_to_claim first", async () => {
            const userId = await user();
            const activeId = await insertContract(userId);
            const readyId = await insertContract(userId, {
                status: GuildContractStatus.READY_TO_CLAIM,
            });

            const response = await request(app.getHttpServer())
                .get("/v1/guild/contracts?tab=accepted")
                .set("x-test-user", userId)
                .expect(200);

            expect(
                response.body.data.map((item: { id: string }) => item.id),
            ).toEqual([readyId, activeId]);
            expect(response.body.pagination).toEqual({
                totalItems: 2,
                totalPages: 1,
                hasNextPage: false,
            });
        });
    });
});
