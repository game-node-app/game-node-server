import "reflect-metadata";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import request from "supertest";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsController } from "../awards.controller";
import { AwardsService } from "../awards.service";
import { AwardsResultService } from "./awards-result.service";
import { AwardsResultProcessor } from "./awards-result.processor";
import { AwardsNominationService } from "../nomination/awards-nomination.service";
import { NotificationCampaignService } from "../../notifications/notification-campaign.service";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategoryResult } from "../entity/awards-category-result.entity";
import { AwardsVote } from "../entity/awards-vote.entity";
import { AwardsNomination } from "../entity/awards-nomination.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { AuthService } from "../../auth/auth.service";

const DATABASE = "awards_result_test";

const GAME_A = 201;
const GAME_B = 202;
const GAME_C = 203;
const GAME_D = 204;
const GAME_PERSONAL = 205;
const GAME_WINNER = 301;
const GAME_LOSER = 401;
const GAME_PERSONAL_SCOREBOARD = 505;

const MAIN_USER = "aaaaaaaa-0000-4000-8000-000000000001";
const MISS_USER = "aaaaaaaa-0000-4000-8000-000000000002";
const X_USER = "aaaaaaaa-0000-4000-8000-000000000003";
const Y_USER = "aaaaaaaa-0000-4000-8000-000000000004";
const Z_USER = "aaaaaaaa-0000-4000-8000-000000000005";

const voterId = (index: number) =>
    `a0000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const VOTERS = Array.from({ length: 1000 }, (_, index) => voterId(index));

jest.setTimeout(180000);

describe("Awards results and scoreboard", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let app: INestApplication;
    let awardsService: AwardsService;
    let resultService: AwardsResultService;
    let processor: AwardsResultProcessor;

    let resultEvent: AwardsEvent;
    let scoreboardEvent: AwardsEvent;
    let emptyEvent: AwardsEvent;
    let playedCategory: AwardsCategory;
    let tieCategory: AwardsCategory;
    let zeroPlayedCategory: AwardsCategory;
    let personalCategory: AwardsCategory;
    let scoreboardCategories: AwardsCategory[];

    const server = () => app.getHttpServer();

    async function insertRows(
        table: string,
        columns: string[],
        rows: unknown[][],
    ) {
        for (let offset = 0; offset < rows.length; offset += 200) {
            const chunk = rows.slice(offset, offset + 200);
            const placeholders = chunk
                .map(() => `(${columns.map(() => "?").join(", ")})`)
                .join(", ");
            await source.query(
                `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`,
                chunk.flat(),
            );
        }
    }

    const insertVotes = (rows: Array<[number, number, string]>) =>
        insertRows(
            "awards_vote",
            ["categoryId", "gameId", "profileUserId"],
            rows,
        );

    const insertPlaytime = (rows: Array<[string, number]>) =>
        insertRows(
            "user_playtime",
            [
                "profileUserId",
                "gameId",
                "source",
                "platformId",
                "totalPlaytimeSeconds",
            ],
            rows.map(([userId, gameId]) => [userId, gameId, "steam", 1, 3600]),
        );

    const voteRows = (
        categoryId: number,
        gameId: number,
        from: number,
        to: number,
    ) =>
        VOTERS.slice(from, to).map((userId): [number, number, string] => [
            categoryId,
            gameId,
            userId,
        ]);

    const playedShare = (result: AwardsCategoryResult, gameId: number) =>
        result.winners.find((winner) => Number(winner.gameId) === gameId);

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;

        const eventRepository = source.getRepository(AwardsEvent);
        const categoryRepository = source.getRepository(AwardsCategory);
        const resultRepository = source.getRepository(AwardsCategoryResult);
        const voteRepository = source.getRepository(AwardsVote);
        const nominationRepository = source.getRepository(AwardsNomination);
        const gameRepository = source.getRepository(Game);

        awardsService = new AwardsService(eventRepository, categoryRepository);
        resultService = new AwardsResultService(
            resultRepository,
            voteRepository,
        );
        processor = new AwardsResultProcessor(
            awardsService,
            resultService,
            new AwardsNominationService(
                nominationRepository,
                categoryRepository,
                gameRepository,
                awardsService,
                source,
            ),
            new NotificationCampaignService(source),
            source,
        );

        await insertRows(
            "profile",
            ["userId", "username"],
            VOTERS.map((userId) => [userId, `v${userId.slice(-6)}`]),
        );
        await insertRows(
            "profile",
            ["userId", "username"],
            [MAIN_USER, MISS_USER, X_USER, Y_USER, Z_USER].map((userId) => [
                userId,
                `s${userId.slice(-4)}`,
            ]),
        );
        await source.query(
            "INSERT INTO game_platform (id, name) VALUES (1, 'PC')",
        );
        await insertRows(
            "game",
            ["id", "name", "slug"],
            [
                GAME_A,
                GAME_B,
                GAME_C,
                GAME_D,
                GAME_PERSONAL,
                GAME_PERSONAL_SCOREBOARD,
            ].map((id) => [
                id,
                `Awards game ${id}`,
                `awards-result-game-${id}`,
            ]),
        );

        resultEvent = await eventRepository.save({
            year: 2026,
            votingStartDate: new Date("2026-12-01T00:00:00Z"),
            votingEndDate: new Date("2026-12-20T00:00:00Z"),
            resultsDate: new Date("2026-12-27T00:00:00Z"),
        });
        playedCategory = await categoryRepository.save({
            eventId: resultEvent.id,
            name: "Played",
            description: "Played-only share",
            order: 1,
        });
        tieCategory = await categoryRepository.save({
            eventId: resultEvent.id,
            name: "Tie",
            description: "Tie broken by played votes",
            order: 2,
        });
        zeroPlayedCategory = await categoryRepository.save({
            eventId: resultEvent.id,
            name: "Zero played",
            description: "No voter played",
            order: 3,
        });
        personalCategory = await categoryRepository.save({
            eventId: resultEvent.id,
            name: "Personal GOTY",
            description: "Personal GOTY",
            order: 0,
            isPersonalGOTY: true,
        });

        // 1000 votes, 600 of them from voters who played the game they voted for:
        // A has 300 votes (174 played), B has 700 (426 played).
        await insertVotes([
            ...voteRows(playedCategory.id, GAME_A, 0, 300),
            ...voteRows(playedCategory.id, GAME_B, 300, 1000),
        ]);
        await insertPlaytime([
            ...VOTERS.slice(0, 174).map((userId): [string, number] => [
                userId,
                GAME_A,
            ]),
            ...VOTERS.slice(300, 726).map((userId): [string, number] => [
                userId,
                GAME_B,
            ]),
        ]);

        // 100 votes each; C is played by 60 voters (55 playtime, 5 finished entries)
        // and D by 40 (plus 5 planned entries that do not count).
        await insertVotes([
            ...voteRows(tieCategory.id, GAME_C, 0, 100),
            ...voteRows(tieCategory.id, GAME_D, 100, 200),
        ]);
        await insertPlaytime([
            ...VOTERS.slice(0, 55).map((userId): [string, number] => [
                userId,
                GAME_C,
            ]),
            ...VOTERS.slice(100, 140).map((userId): [string, number] => [
                userId,
                GAME_D,
            ]),
        ]);
        await insertRows(
            "library",
            ["userId"],
            [...VOTERS.slice(55, 60), ...VOTERS.slice(140, 145)].map(
                (userId) => [userId],
            ),
        );
        await insertRows(
            "collection_entry",
            ["id", "gameId", "libraryUserId", "status"],
            [
                ...VOTERS.slice(55, 60).map((userId, index) => [
                    `bbbbbbbb-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
                    GAME_C,
                    userId,
                    "finished",
                ]),
                ...VOTERS.slice(140, 145).map((userId, index) => [
                    `cccccccc-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
                    GAME_D,
                    userId,
                    "planned",
                ]),
            ],
        );

        // No voter played A or B in this category.
        await insertVotes([
            ...voteRows(zeroPlayedCategory.id, GAME_A, 200, 300),
            ...voteRows(zeroPlayedCategory.id, GAME_B, 726, 826),
        ]);

        scoreboardEvent = await eventRepository.save({
            year: 2027,
            votingStartDate: new Date("2027-12-01T00:00:00Z"),
            votingEndDate: new Date("2027-12-20T00:00:00Z"),
            resultsDate: new Date("2027-12-27T00:00:00Z"),
        });
        scoreboardCategories = [];
        for (let order = 1; order <= 11; order++) {
            scoreboardCategories.push(
                await categoryRepository.save({
                    eventId: scoreboardEvent.id,
                    name: `Category ${order}`,
                    description: "Scoreboard",
                    order,
                }),
            );
        }
        const scoreboardPersonal = await categoryRepository.save({
            eventId: scoreboardEvent.id,
            name: "Personal GOTY",
            description: "Personal GOTY",
            order: 0,
            isPersonalGOTY: true,
        });
        for (const [index, category] of scoreboardCategories.entries()) {
            const winnerId = GAME_WINNER + index;
            const loserId = GAME_LOSER + index;
            await source.query(
                "INSERT INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?)",
                [
                    winnerId,
                    `Winner ${index}`,
                    `awards-scoreboard-winner-${index}`,
                    loserId,
                    `Loser ${index}`,
                    `awards-scoreboard-loser-${index}`,
                ],
            );
            await insertVotes([
                [category.id, winnerId, X_USER],
                [category.id, winnerId, Z_USER],
                [category.id, loserId, Y_USER],
            ]);
            if (index <= 6) {
                await insertVotes([[category.id, winnerId, MAIN_USER]]);
            }
            if (index === 7) {
                await insertVotes([[category.id, loserId, MAIN_USER]]);
            }
        }
        await insertVotes([
            [scoreboardPersonal.id, GAME_PERSONAL_SCOREBOARD, MAIN_USER],
            ...VOTERS.slice(0, 312).map((userId): [number, number, string] => [
                scoreboardPersonal.id,
                GAME_PERSONAL_SCOREBOARD,
                userId,
            ]),
        ]);

        emptyEvent = await eventRepository.save({
            year: 2028,
            votingStartDate: new Date("2028-12-01T00:00:00Z"),
            votingEndDate: new Date("2028-12-20T00:00:00Z"),
            resultsDate: new Date("2028-12-27T00:00:00Z"),
        });
        await categoryRepository.save({
            eventId: emptyEvent.id,
            name: "Empty",
            description: "No results yet",
            order: 1,
        });

        const moduleRef = await Test.createTestingModule({
            controllers: [AwardsController],
            providers: [
                AwardsService,
                AwardsResultService,
                { provide: DataSource, useValue: source },
                {
                    provide: getRepositoryToken(AwardsEvent),
                    useValue: eventRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategory),
                    useValue: categoryRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategoryResult),
                    useValue: resultRepository,
                },
                {
                    provide: getRepositoryToken(AwardsVote),
                    useValue: voteRepository,
                },
                {
                    provide: AuthService,
                    useValue: { getSession: async () => null },
                },
            ],
        }).compile();

        awardsService = moduleRef.get(AwardsService);
        resultService = moduleRef.get(AwardsResultService);
        app = moduleRef.createNestApplication();
        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();

        await processor.processEventResults(resultEvent);
        await processor.processEventResults(scoreboardEvent);
    });

    afterAll(async () => {
        if (app) await app.close();
        await cleanup?.();
    });

    describe("result computation", () => {
        it("keeps the played-only share out of the total votes (174 of 600)", async () => {
            const results = await resultService.getCategoryResultsByEventId(
                resultEvent.id,
            );
            const played = results.find(
                (result) => result.categoryId === playedCategory.id,
            )!;

            expect(played.totalVotesCount).toBe(1000);
            expect(played.totalPlayedVotesCount).toBe(600);
            expect(Number(playedShare(played, GAME_A)!.playedVotes)).toBe(174);
            expect(Number(playedShare(played, GAME_A)!.totalVotes)).toBe(300);
            expect(
                Number(playedShare(played, GAME_A)!.votesPercentage),
            ).toBeCloseTo(0.3, 5);
            expect(
                Number(playedShare(played, GAME_A)!.playedVotesPercentage),
            ).toBeCloseTo(0.29, 5);
            expect(
                Number(playedShare(played, GAME_B)!.playedVotesPercentage),
            ).toBeCloseTo(0.71, 5);
        });

        it("breaks a vote tie by played votes, counting finished entries as played", async () => {
            const results = await resultService.getCategoryResultsByEventId(
                resultEvent.id,
            );
            const tie = results.find(
                (result) => result.categoryId === tieCategory.id,
            )!;

            expect(Number(tie.totalPlayedVotesCount)).toBe(100);
            expect(playedShare(tie, GAME_C)).toMatchObject({
                position: 1,
                totalVotes: 100,
                playedVotes: 60,
            });
            expect(playedShare(tie, GAME_D)).toMatchObject({
                position: 2,
                totalVotes: 100,
                playedVotes: 40,
            });
            expect(
                Number(playedShare(tie, GAME_D)!.playedVotesPercentage),
            ).toBeCloseTo(0.4, 5);
        });

        it("stores a zero played-only total and zero shares when nobody played", async () => {
            const results = await resultService.getCategoryResultsByEventId(
                resultEvent.id,
            );
            const zero = results.find(
                (result) => result.categoryId === zeroPlayedCategory.id,
            )!;

            expect(zero.totalPlayedVotesCount).toBe(0);
            expect(zero.winners).toHaveLength(2);
            for (const winner of zero.winners) {
                expect(Number(winner.playedVotes)).toBe(0);
                expect(Number(winner.playedVotesPercentage)).toBe(0);
            }
        });

        it("does not add results on a second run", async () => {
            const before = await resultService.getCategoryResultsByEventId(
                resultEvent.id,
            );

            await processor.processEventResults(resultEvent);

            const after = await resultService.getCategoryResultsByEventId(
                resultEvent.id,
            );
            expect(after).toHaveLength(before.length);
            expect(after.map((result) => result.id)).toEqual(
                before.map((result) => result.id),
            );
        });

        it("keeps the public results read backward compatible and sorted", async () => {
            const response = await request(server())
                .get(`/v1/awards/${resultEvent.id}/results`)
                .expect(200);

            expect(response.body).toHaveLength(4);
            expect(
                response.body.map(
                    (row: { categoryId: number }) => row.categoryId,
                ),
            ).toEqual([
                playedCategory.id,
                tieCategory.id,
                zeroPlayedCategory.id,
                personalCategory.id,
            ]);
            const played = response.body[0];
            expect(played.totalVotesCount).toBe(1000);
            expect(played.totalPlayedVotesCount).toBe(600);
            expect(played.totalUniqueGamesSubmitted).toBe(2);
            expect(played.totalUsersParticipating).toBe(1000);
            expect(
                played.winners.map(
                    (winner: { position: number }) => winner.position,
                ),
            ).toEqual([1, 2]);
            expect(played.winners[0]).toMatchObject({
                gameId: GAME_B,
                playedVotes: 426,
            });
        });

        it("returns an empty list before results are computed", async () => {
            const response = await request(server())
                .get(`/v1/awards/${emptyEvent.id}/results`)
                .expect(200);

            expect(response.body).toEqual([]);
        });
    });

    describe("scoreboard", () => {
        it("reports 7 hits, 8 voted and 11 scorable with the shared personal GOTY", async () => {
            const response = await request(server())
                .get(`/v1/awards/${scoreboardEvent.id}/scoreboard/${MAIN_USER}`)
                .expect(200);

            expect(response.body.totals).toEqual({
                hits: 7,
                voted: 8,
                scorable: 11,
            });
            expect(response.body.categories).toHaveLength(11);
            expect(
                response.body.categories.map(
                    (category: { outcome: string }) => category.outcome,
                ),
            ).toEqual([
                ...Array.from({ length: 7 }, () => "hit"),
                "miss",
                "not_voted",
                "not_voted",
                "not_voted",
            ]);
            expect(response.body.personalGOTY).toEqual({
                gameId: GAME_PERSONAL_SCOREBOARD,
                otherUsersCount: 312,
            });
        });

        it("returns a null personal GOTY when the user did not vote for one", async () => {
            const response = await request(server())
                .get(`/v1/awards/${scoreboardEvent.id}/scoreboard/${MISS_USER}`)
                .expect(200);

            expect(response.body.personalGOTY).toBeNull();
            expect(response.body.totals).toEqual({
                hits: 0,
                voted: 0,
                scorable: 11,
            });
        });

        it("returns 404 before results exist", async () => {
            await request(server())
                .get(`/v1/awards/${emptyEvent.id}/scoreboard/${MAIN_USER}`)
                .expect(404);
        });
    });
});
