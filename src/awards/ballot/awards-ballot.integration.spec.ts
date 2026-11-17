jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));

import "reflect-metadata";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import request from "supertest";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsBallotController } from "./awards-ballot.controller";
import { AwardsBallotService } from "./awards-ballot.service";
import { AwardsVoteController } from "../vote/awards-vote.controller";
import { AwardsVoteService } from "../vote/awards-vote.service";
import { AwardsService } from "../awards.service";
import { AwardsAdminService } from "../admin/awards-admin.service";
import { AwardsPlayContextService } from "../play-context/awards-play-context.service";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategoryTranslation } from "../entity/awards-category-translation.entity";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { AwardsVote } from "../entity/awards-vote.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { UserPlaytimeHistory } from "../../playtime/entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { Review } from "../../reviews/entities/review.entity";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
import { AuthService } from "../../auth/auth.service";

const DATABASE = "awards_ballot_test";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PLATFORM = 1;

const GOTY_NOMINEES = [301, 302, 303, 304, 305, 306];
const NARRATIVE_NOMINEE = 307;
const ELIGIBLE_NON_NOMINEE = 308;
const RELEASED_IN_2025 = 309;
const SUGGESTION_WINNER = 310;
const SUGGESTION_RUNNER_UP = 311;
const LOWER_RATED = 312;
const LEGACY_GAME = 313;
const AFTER_CUTOFF = 314;

jest.setTimeout(120000);

describe("Awards ballot, votes and vote rules", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let app: INestApplication;
    let ballotService: AwardsBallotService;
    let voteService: AwardsVoteService;
    let awardsService: AwardsService;
    let voteRepository: Repository<AwardsVote>;
    let history: PlaytimeHistoryService;
    const achievementsQueue = { addTrackingJob: jest.fn() };

    let openEvent: AwardsEvent;
    let legacyEvent: AwardsEvent;
    let upcomingEvent: AwardsEvent;
    let endedEvent: AwardsEvent;
    let categories: AwardsCategory[];
    let personalCategory: AwardsCategory;
    let narrativeCategory: AwardsCategory;
    let legacyCategory: AwardsCategory;
    let upcomingCategory: AwardsCategory;
    let endedCategory: AwardsCategory;

    const server = () => app.getHttpServer();

    const voteCountFor = (userId: string, categoryId: number) =>
        voteRepository.countBy({ profileUserId: userId, categoryId });

    const observePlaytime = (
        userId: string,
        gameId: number,
        samples: Array<[string, number]>,
    ) =>
        Promise.all(
            samples.map(([at, total]) =>
                history.save(
                    {
                        profileUserId: userId,
                        gameId,
                        source: "steam",
                        platformId: PLATFORM,
                        totalPlaytimeSeconds: total,
                    } as any,
                    new Date(at),
                ),
            ),
        );

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;
        voteRepository = source.getRepository(AwardsVote);
        history = new PlaytimeHistoryService(
            source.getRepository(UserPlaytimeHistory),
            {} as any,
        );

        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?), (?, ?), (?, ?)",
            [USER_A, "ballot-a", USER_B, "ballot-b", USER_C, "ballot-c"],
        );
        await source.query(
            "INSERT INTO library (userId) VALUES (?), (?), (?)",
            [USER_A, USER_B, USER_C],
        );
        await source.query(
            "INSERT INTO game_platform (id, name) VALUES (?, 'PC')",
            [PLATFORM],
        );

        const gameRows: Array<[number, string, string | null]> = [
            [301, "GOTY One", "2026-03-01 00:00:00"],
            [302, "GOTY Two", "2026-03-01 00:00:00"],
            [303, "GOTY Three", "2026-03-01 00:00:00"],
            [304, "GOTY Four", "2026-03-01 00:00:00"],
            [305, "GOTY Five", "2026-03-01 00:00:00"],
            [306, "GOTY Six", "2026-03-01 00:00:00"],
            [NARRATIVE_NOMINEE, "Narrative", "2026-04-01 00:00:00"],
            [ELIGIBLE_NON_NOMINEE, "Free Vote", "2026-04-01 00:00:00"],
            [RELEASED_IN_2025, "Old Game", "2025-04-01 00:00:00"],
            [SUGGESTION_WINNER, "Suggested A", "2026-05-01 00:00:00"],
            [SUGGESTION_RUNNER_UP, "Suggested B", "2026-05-01 00:00:00"],
            [LOWER_RATED, "Suggested C", "2026-05-01 00:00:00"],
            [LEGACY_GAME, "Legacy Game", "2025-04-01 00:00:00"],
            [AFTER_CUTOFF, "Late Game", "2026-12-05 00:00:00"],
        ];
        await source.query(
            `INSERT INTO game (id, name, slug, firstReleaseDate) VALUES ${gameRows
                .map(() => "(?, ?, ?, ?)")
                .join(", ")}`,
            gameRows.flatMap(([id, name, release]) => [
                id,
                name,
                `ballot-game-${id}`,
                release,
            ]),
        );

        const eventRepository = source.getRepository(AwardsEvent);
        const categoryRepository = source.getRepository(AwardsCategory);
        const suggestionRepository = source.getRepository(
            AwardsCategorySuggestion,
        );

        openEvent = await eventRepository.save({
            year: 2026,
            nominationStartDate: new Date("2000-01-01T00:00:00Z"),
            nominationEndDate: new Date("2000-01-02T00:00:00Z"),
            votingStartDate: new Date("2000-01-03T00:00:00Z"),
            votingEndDate: new Date("2100-01-01T00:00:00Z"),
            resultsDate: new Date("2100-01-02T00:00:00Z"),
            eligibilityCutoffDate: new Date("2026-11-30T00:00:00Z"),
        });
        legacyEvent = await eventRepository.save({
            year: 2025,
            votingStartDate: new Date("2000-01-01T00:00:00Z"),
            votingEndDate: new Date("2100-01-01T00:00:00Z"),
            resultsDate: new Date("2100-01-02T00:00:00Z"),
        });
        upcomingEvent = await eventRepository.save({
            year: 2028,
            votingStartDate: new Date("2100-01-01T00:00:00Z"),
            votingEndDate: new Date("2100-02-01T00:00:00Z"),
            resultsDate: new Date("2100-03-01T00:00:00Z"),
        });
        endedEvent = await eventRepository.save({
            year: 2024,
            votingStartDate: new Date("2000-01-01T00:00:00Z"),
            votingEndDate: new Date("2000-02-01T00:00:00Z"),
            resultsDate: new Date("2000-03-01T00:00:00Z"),
        });

        personalCategory = await categoryRepository.save({
            eventId: openEvent.id,
            name: "Your Game of the Year",
            description: "Personal GOTY",
            order: 0,
            isPersonalGOTY: true,
        });
        categories = [personalCategory];
        for (let order = 1; order <= 11; order++) {
            categories.push(
                await categoryRepository.save({
                    eventId: openEvent.id,
                    name: `Category ${order}`,
                    description: `Category ${order}`,
                    order,
                }),
            );
        }
        narrativeCategory = categories[1];
        await source.getRepository(AwardsCategoryTranslation).save({
            categoryId: narrativeCategory.id,
            locale: "pt-BR",
            name: "Categoria 1 (PT)",
            description: "Categoria 1 (PT)",
        });
        legacyCategory = await categoryRepository.save({
            eventId: legacyEvent.id,
            name: "Legacy Category",
            description: "Legacy",
            order: 1,
        });
        upcomingCategory = await categoryRepository.save({
            eventId: upcomingEvent.id,
            name: "Upcoming Category",
            description: "Upcoming",
            order: 1,
        });
        endedCategory = await categoryRepository.save({
            eventId: endedEvent.id,
            name: "Ended Category",
            description: "Ended",
            order: 1,
        });

        await suggestionRepository.save([
            ...GOTY_NOMINEES.map((gameId) => ({
                categoryId: personalCategory.id,
                gameId,
            })),
            {
                categoryId: narrativeCategory.id,
                gameId: NARRATIVE_NOMINEE,
            },
            ...GOTY_NOMINEES.map((gameId) => ({
                categoryId: categories[2].id,
                gameId,
            })),
        ]);

        const entry = async (
            id: string,
            userId: string,
            gameId: number,
            status: CollectionEntryStatus,
            startedAt: Date | null = null,
            finishedAt: Date | null = null,
        ) =>
            source.query(
                `INSERT INTO collection_entry (id, gameId, libraryUserId, status, startedAt, finishedAt)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, gameId, userId, status, startedAt, finishedAt],
            );

        // Four of the six GOTY nominees are played by USER_A.
        await source.query(
            `INSERT INTO user_playtime (profileUserId, gameId, source, platformId, totalPlaytimeSeconds)
             VALUES (?, ?, 'steam', ?, 309600)`,
            [USER_A, GOTY_NOMINEES[0], PLATFORM],
        );
        await entry(
            "goty-1",
            USER_A,
            GOTY_NOMINEES[0],
            CollectionEntryStatus.PLAYING,
        );
        await entry(
            "goty-2",
            USER_A,
            GOTY_NOMINEES[1],
            CollectionEntryStatus.FINISHED,
        );
        await entry(
            "goty-3",
            USER_A,
            GOTY_NOMINEES[2],
            CollectionEntryStatus.DROPPED,
        );
        await entry(
            "goty-4",
            USER_A,
            GOTY_NOMINEES[3],
            CollectionEntryStatus.PLANNED,
            new Date("2026-04-01T00:00:00Z"),
        );
        await entry(
            "goty-5",
            USER_A,
            GOTY_NOMINEES[4],
            CollectionEntryStatus.PLANNED,
        );
        await source.query(
            `INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId)
             VALUES ('review-goty-1', 'ok', 4.5, ?, ?, 'goty-1')`,
            [GOTY_NOMINEES[0], USER_A],
        );

        // Suggestions: equal ratings, decided by playtime in the event year.
        for (const [gameId, seconds, rating] of [
            [SUGGESTION_WINNER, 309600, 4.5],
            [SUGGESTION_RUNNER_UP, 115200, 4.5],
            [LOWER_RATED, 3600000, 4],
        ] as const) {
            await entry(
                `suggestion-${gameId}`,
                USER_A,
                gameId,
                CollectionEntryStatus.PLAYING,
            );
            await source.query(
                `INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId)
                 VALUES (?, 'ok', ?, ?, ?, ?)`,
                [
                    `review-${gameId}`,
                    rating,
                    gameId,
                    USER_A,
                    `suggestion-${gameId}`,
                ],
            );
            await observePlaytime(USER_A, gameId, [
                ["2025-12-31T00:00:00Z", 0],
                [
                    `2026-06-0${gameId === SUGGESTION_WINNER ? 1 : 2}T00:00:00Z`,
                    seconds,
                ],
            ]);
        }

        // USER_A voted in 7 of the 12 categories.
        await voteRepository.save([
            ...categories.slice(1, 7).map((category, index) => ({
                categoryId: category.id,
                gameId: index === 0 ? NARRATIVE_NOMINEE : ELIGIBLE_NON_NOMINEE,
                profileUserId: USER_A,
            })),
            {
                categoryId: personalCategory.id,
                gameId: SUGGESTION_WINNER,
                profileUserId: USER_A,
            },
        ]);

        const moduleRef = await Test.createTestingModule({
            controllers: [AwardsBallotController, AwardsVoteController],
            providers: [
                AwardsBallotService,
                AwardsVoteService,
                AwardsService,
                AwardsPlayContextService,
                {
                    provide: getRepositoryToken(AwardsEvent),
                    useValue: eventRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategory),
                    useValue: categoryRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategorySuggestion),
                    useValue: suggestionRepository,
                },
                {
                    provide: getRepositoryToken(AwardsVote),
                    useValue: voteRepository,
                },
                {
                    provide: getRepositoryToken(Game),
                    useValue: source.getRepository(Game),
                },
                {
                    provide: getRepositoryToken(UserPlaytime),
                    useValue: source.getRepository(UserPlaytime),
                },
                {
                    provide: getRepositoryToken(CollectionEntry),
                    useValue: source.getRepository(CollectionEntry),
                },
                {
                    provide: getRepositoryToken(Review),
                    useValue: source.getRepository(Review),
                },
                {
                    provide: GameRepositoryService,
                    useValue: {
                        findOneByIdOrFail: (id: number) =>
                            source.getRepository(Game).findOneByOrFail({ id }),
                    },
                },
                { provide: PlaytimeHistoryService, useValue: history },
                {
                    provide: AchievementsQueueService,
                    useValue: achievementsQueue,
                },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: async (req: {
                            headers: { authorization?: string };
                        }) => {
                            const id = req.headers.authorization?.replace(
                                "Bearer ",
                                "",
                            );
                            if (id === "user-a")
                                return { user: { id: USER_A, role: "user" } };
                            if (id === "user-b")
                                return { user: { id: USER_B, role: "user" } };
                            return null;
                        },
                    },
                },
            ],
        }).compile();

        ballotService = moduleRef.get(AwardsBallotService);
        voteService = moduleRef.get(AwardsVoteService);
        awardsService = moduleRef.get(AwardsService);
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
    });

    afterAll(async () => {
        if (app) await app.close();
        await cleanup?.();
    });

    const expectBadRequest = async (work: Promise<unknown>) => {
        let error: any;
        try {
            await work;
        } catch (caught) {
            error = caught;
        }
        expect(error?.getStatus?.()).toBe(400);
        return error?.message as string;
    };

    it("rejects a vote for an eligible non-nominee in a nominations event", async () => {
        const message = await expectBadRequest(
            voteService.registerVote(USER_B, {
                categoryId: narrativeCategory.id,
                gameId: ELIGIBLE_NON_NOMINEE,
            }),
        );

        expect(message).toContain("not a nominee");
        expect(await voteCountFor(USER_B, narrativeCategory.id)).toBe(0);
    });

    it("accepts a nominee and enqueues both tracking metrics", async () => {
        achievementsQueue.addTrackingJob.mockReset();

        await voteService.registerVote(USER_B, {
            categoryId: narrativeCategory.id,
            gameId: NARRATIVE_NOMINEE,
        });

        expect(await voteCountFor(USER_B, narrativeCategory.id)).toBe(1);
        expect(achievementsQueue.addTrackingJob).toHaveBeenCalledWith({
            userId: USER_B,
            metric: "awards_participation",
        });
        expect(achievementsQueue.addTrackingJob).toHaveBeenCalledWith({
            userId: USER_B,
            metric: "awards_ballot_completed",
        });
    });

    it("keeps personal GOTY open to any eligible game", async () => {
        await voteService.registerVote(USER_B, {
            categoryId: personalCategory.id,
            gameId: SUGGESTION_WINNER,
        });

        expect(await voteCountFor(USER_B, personalCategory.id)).toBe(1);
    });

    it("replaces a repeated vote in the same category", async () => {
        await voteService.registerVote(USER_B, {
            categoryId: categories[2].id,
            gameId: GOTY_NOMINEES[0],
        });
        await voteService.registerVote(USER_B, {
            categoryId: categories[2].id,
            gameId: GOTY_NOMINEES[1],
        });

        const votes = await voteRepository.findBy({
            profileUserId: USER_B,
            categoryId: categories[2].id,
        });
        expect(votes).toHaveLength(1);
        expect(votes[0].gameId).toBe(GOTY_NOMINEES[1]);
    });

    it("keeps legacy events without nominations unchanged", async () => {
        await voteService.registerVote(USER_B, {
            categoryId: legacyCategory.id,
            gameId: LEGACY_GAME,
        });

        expect(await voteCountFor(USER_B, legacyCategory.id)).toBe(1);
    });

    it("rejects games released outside the year or after the cutoff", async () => {
        await expectBadRequest(
            voteService.registerVote(USER_B, {
                categoryId: narrativeCategory.id,
                gameId: RELEASED_IN_2025,
            }),
        );
        await expectBadRequest(
            voteService.registerVote(USER_B, {
                categoryId: narrativeCategory.id,
                gameId: AFTER_CUTOFF,
            }),
        );
        expect(
            (
                await voteRepository.findOneByOrFail({
                    profileUserId: USER_B,
                    categoryId: narrativeCategory.id,
                })
            ).gameId,
        ).toBe(NARRATIVE_NOMINEE);
    });

    it("rejects votes before voting starts and after it ends with the reason", async () => {
        const beforeStart = await expectBadRequest(
            voteService.registerVote(USER_B, {
                categoryId: upcomingCategory.id,
                gameId: LEGACY_GAME,
            }),
        );
        expect(beforeStart).toContain("not started");

        const afterEnd = await expectBadRequest(
            voteService.registerVote(USER_B, {
                categoryId: endedCategory.id,
                gameId: LEGACY_GAME,
            }),
        );
        expect(afterEnd).toContain("ended");
    });

    it("returns the ballot with progress, played counts and the GOTY suggestion", async () => {
        const ballot = await ballotService.getBallot(USER_A, openEvent.id);

        expect(ballot.eventId).toBe(openEvent.id);
        expect(ballot.year).toBe(2026);
        expect(ballot.phase).toBe("voting");
        expect(ballot.categoriesVoted).toBe(7);
        expect(ballot.categoriesTotal).toBe(12);
        expect(ballot.categories.map((category) => category.order)).toEqual(
            Array.from({ length: 12 }, (_, index) => index),
        );

        const personal = ballot.categories[0];
        expect(personal.isPersonalGOTY).toBe(true);
        expect(personal.voteGameId).toBe(SUGGESTION_WINNER);
        expect(personal.playedNomineesCount).toBe(4);
        expect(personal.nominees.map((nominee) => nominee.gameId)).toEqual(
            GOTY_NOMINEES,
        );
        expect(personal.nominees[0]).toEqual({
            gameId: GOTY_NOMINEES[0],
            status: "played",
            playtimeSeconds: 309600,
            rating: 4.5,
        });
        expect(personal.nominees[4]).toEqual({
            gameId: GOTY_NOMINEES[4],
            status: "planned",
            playtimeSeconds: 0,
            rating: null,
        });
        expect(personal.nominees[5]).toEqual({
            gameId: GOTY_NOMINEES[5],
            status: "not_played",
            playtimeSeconds: 0,
            rating: null,
        });
        expect(personal.suggestedGameId).toBe(SUGGESTION_WINNER);

        const narrative = ballot.categories.find(
            (category) => category.id === narrativeCategory.id,
        );
        expect(narrative?.name).toBe("Category 1");
        expect(narrative?.description).toBe("Category 1");
        expect(narrative?.translations).toEqual([
            {
                locale: "pt-BR",
                name: "Categoria 1 (PT)",
                description: "Categoria 1 (PT)",
            },
        ]);
        expect(narrative?.voteGameId).toBe(NARRATIVE_NOMINEE);
        expect(narrative?.suggestedGameId).toBeNull();
        expect(ballot.categories[2].translations).toEqual([]);
        expect(ballot.categories[6].voteGameId).not.toBeNull();
        expect(ballot.categories[7].voteGameId).toBeNull();
    });

    it("returns a null suggestion when the user played no eligible game", async () => {
        const ballot = await ballotService.getBallot(USER_C, openEvent.id);

        expect(ballot.categoriesVoted).toBe(0);
        expect(ballot.categories[0].suggestedGameId).toBeNull();
    });

    it("serves the ballot publicly for shared links and rejects unknown events", async () => {
        const response = await request(server())
            .get(`/v1/awards/${openEvent.id}/votes/${USER_A}`)
            .expect(200);

        expect(response.body).toHaveLength(7);
        expect(response.body[0]).toEqual({
            categoryId: personalCategory.id,
            gameId: SUGGESTION_WINNER,
        });
        expect(response.body[1]).toEqual({
            categoryId: narrativeCategory.id,
            gameId: NARRATIVE_NOMINEE,
        });

        const empty = await request(server())
            .get(`/v1/awards/${openEvent.id}/votes/${USER_C}`)
            .expect(200);
        expect(empty.body).toEqual([]);

        await request(server())
            .get(`/v1/awards/999999/votes/${USER_A}`)
            .expect(404);
    });

    it("requires a session for the ballot and for voting", async () => {
        await request(server())
            .get(`/v1/awards/${openEvent.id}/ballot`)
            .expect(401);
        await request(server())
            .post("/v1/awards/vote")
            .send({ categoryId: narrativeCategory.id, gameId: 307 })
            .expect(401);
    });

    it("serves the ballot over HTTP for a signed-in user", async () => {
        const response = await request(server())
            .get(`/v1/awards/${openEvent.id}/ballot`)
            .set("Authorization", "Bearer user-a")
            .expect(200);

        expect(response.body.categoriesVoted).toBe(7);
        expect(response.body.categoriesTotal).toBe(12);
        expect(response.body.categories[0].suggestedGameId).toBe(
            SUGGESTION_WINNER,
        );
    });

    it("stores a vote over HTTP and replaces the previous one", async () => {
        await request(server())
            .post("/v1/awards/vote")
            .set("Authorization", "Bearer user-b")
            .send({
                categoryId: narrativeCategory.id,
                gameId: NARRATIVE_NOMINEE,
            })
            .expect(201);

        const response = await request(server())
            .get(`/v1/awards/${openEvent.id}/votes/${USER_B}`)
            .expect(200);

        expect(
            response.body.filter(
                (vote: { categoryId: number }) =>
                    vote.categoryId === narrativeCategory.id,
            ),
        ).toEqual([
            {
                categoryId: narrativeCategory.id,
                gameId: NARRATIVE_NOMINEE,
            },
        ]);
    });

    it("shows an admin nominee replacement in the public categories and the ballot", async () => {
        const eventRepository = source.getRepository(AwardsEvent);
        const categoryRepository = source.getRepository(AwardsCategory);
        const suggestionRepository = source.getRepository(
            AwardsCategorySuggestion,
        );

        const curatedEvent = await eventRepository.save({
            year: 2029,
            nominationStartDate: new Date("2000-01-01T00:00:00Z"),
            nominationEndDate: new Date("2000-01-02T00:00:00Z"),
            votingStartDate: new Date("2100-01-01T00:00:00Z"),
            votingEndDate: new Date("2100-02-01T00:00:00Z"),
            resultsDate: new Date("2100-02-02T00:00:00Z"),
        });
        const curatedCategory = await categoryRepository.save({
            eventId: curatedEvent.id,
            name: "Curated",
            description: "Curated",
            order: 1,
        });
        await suggestionRepository.save([
            { categoryId: curatedCategory.id, gameId: GOTY_NOMINEES[0] },
            { categoryId: curatedCategory.id, gameId: GOTY_NOMINEES[1] },
        ]);

        const adminService = new AwardsAdminService(
            eventRepository,
            categoryRepository,
            suggestionRepository,
            awardsService,
            source,
        );
        await adminService.removeCategorySuggestion({
            categoryId: curatedCategory.id,
            gameId: GOTY_NOMINEES[0],
        });
        await adminService.addCategorySuggestion({
            categoryId: curatedCategory.id,
            gameId: ELIGIBLE_NON_NOMINEE,
        });

        const publicCategories = await awardsService.getCategoriesByEventId(
            curatedEvent.id,
        );
        expect(
            publicCategories[0].suggestions
                .map((suggestion) => Number(suggestion.gameId))
                .sort((a, b) => a - b),
        ).toEqual([GOTY_NOMINEES[1], ELIGIBLE_NON_NOMINEE]);

        const ballot = await ballotService.getBallot(USER_C, curatedEvent.id);
        expect(
            ballot.categories[0].nominees.map((nominee) => nominee.gameId),
        ).toEqual([GOTY_NOMINEES[1], ELIGIBLE_NON_NOMINEE]);
    });

    it("returns recent votes with category translations and base text", async () => {
        await voteRepository.save({
            categoryId: narrativeCategory.id,
            gameId: NARRATIVE_NOMINEE,
            profileUserId: USER_C,
        });

        const response = await request(server())
            .get(`/v1/awards/vote/${openEvent.id}/recent`)
            .expect(200);

        const translated = response.body.find(
            (vote: { profileUserId: string }) => vote.profileUserId === USER_C,
        );
        expect(translated.category.name).toBe("Category 1");
        expect(translated.category.description).toBe("Category 1");
        expect(translated.category.translations).toMatchObject([
            {
                locale: "pt-BR",
                name: "Categoria 1 (PT)",
                description: "Categoria 1 (PT)",
            },
        ]);

        const untranslated = response.body.find(
            (vote: { profileUserId: string }) => vote.profileUserId === USER_A,
        );
        expect(untranslated.category.translations).toEqual([]);
    });
});
