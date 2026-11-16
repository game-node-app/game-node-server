import "reflect-metadata";
import {
    HttpException,
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import request from "supertest";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsNominationController } from "./awards-nomination.controller";
import { AwardsNominationService } from "./awards-nomination.service";
import { AwardsService } from "../awards.service";
import { AwardsAdminService } from "../admin/awards-admin.service";
import { AwardsNomination } from "../entity/awards-nomination.entity";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { AuthService } from "../../auth/auth.service";

const DATABASE = "awards_nomination_test";
const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";
const USER_C = "33333333-3333-3333-3333-333333333333";
const GAME_A = 101;
const GAME_B = 102;
const GAME_OUT_OF_YEAR = 103;
const GAME_AFTER_CUTOFF = 104;
const GAME_NO_RELEASE_DATE = 105;
const GAME_F = 106;

jest.setTimeout(120000);

const expectBadRequest = async (work: Promise<unknown>) => {
    let error: unknown;
    try {
        await work;
    } catch (caught) {
        error = caught;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
};

describe("Awards nominations", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let app: INestApplication;
    let nominationService: AwardsNominationService;
    let awardsService: AwardsService;
    let nominationRepository: Repository<AwardsNomination>;
    let categoryRepository: Repository<AwardsCategory>;
    let suggestionRepository: Repository<AwardsCategorySuggestion>;
    let eventRepository: Repository<AwardsEvent>;

    let openEvent: AwardsEvent;
    let closedEvent: AwardsEvent;
    let legacyEvent: AwardsEvent;
    let openCategories: AwardsCategory[];
    let openPersonalCategory: AwardsCategory;
    let closedCategory: AwardsCategory;
    let legacyCategory: AwardsCategory;

    const server = () => app.getHttpServer();

    const gameIdsFor = async (userId: string, categoryId: number) => {
        const rows = await nominationRepository.findBy({
            profileUserId: userId,
            categoryId,
        });
        return rows.map((row) => Number(row.gameId)).sort((a, b) => a - b);
    };

    const resetOpenNominations = (userId: string) =>
        nominationRepository.delete({
            profileUserId: userId,
            categoryId: In(
                [...openCategories, openPersonalCategory].map(
                    (category) => category.id,
                ),
            ),
        });

    const readSuggestions = async (categoryId: number) => {
        const rows = await suggestionRepository.findBy({ categoryId });
        return rows.map((row) => Number(row.gameId)).sort((a, b) => a - b);
    };

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;
        nominationRepository = source.getRepository(AwardsNomination);
        categoryRepository = source.getRepository(AwardsCategory);
        suggestionRepository = source.getRepository(AwardsCategorySuggestion);
        eventRepository = source.getRepository(AwardsEvent);

        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?), (?, ?), (?, ?)",
            [USER_A, "awards-a", USER_B, "awards-b", USER_C, "awards-c"],
        );
        await source.query(
            `INSERT INTO game (id, name, slug, firstReleaseDate) VALUES
             (?, 'Game A', 'awards-game-a', '2026-05-01 00:00:00'),
             (?, 'Game B', 'awards-game-b', '2026-06-01 00:00:00'),
             (?, 'Game Old', 'awards-game-old', '2025-05-01 00:00:00'),
             (?, 'Game Late', 'awards-game-late', '2026-12-05 00:00:00'),
             (?, 'Game Unknown', 'awards-game-unknown', NULL),
             (?, 'Game F', 'awards-game-f', '2026-08-01 00:00:00')`,
            [
                GAME_A,
                GAME_B,
                GAME_OUT_OF_YEAR,
                GAME_AFTER_CUTOFF,
                GAME_NO_RELEASE_DATE,
                GAME_F,
            ],
        );

        openEvent = await eventRepository.save({
            year: 2026,
            nominationStartDate: new Date("2000-01-01T00:00:00Z"),
            nominationEndDate: new Date("2100-01-01T00:00:00Z"),
            votingStartDate: new Date("2100-01-02T00:00:00Z"),
            votingEndDate: new Date("2100-02-01T00:00:00Z"),
            resultsDate: new Date("2100-02-02T00:00:00Z"),
            eligibilityCutoffDate: new Date("2026-11-30T00:00:00Z"),
        });
        closedEvent = await eventRepository.save({
            year: 2025,
            nominationStartDate: new Date("2025-11-03T00:00:00Z"),
            nominationEndDate: new Date("2025-11-16T00:00:00Z"),
            votingStartDate: new Date("2025-12-01T00:00:00Z"),
            votingEndDate: new Date("2025-12-20T00:00:00Z"),
            resultsDate: new Date("2025-12-27T00:00:00Z"),
        });
        legacyEvent = await eventRepository.save({
            year: 2024,
            votingStartDate: new Date("2024-12-01T00:00:00Z"),
            votingEndDate: new Date("2024-12-20T00:00:00Z"),
            resultsDate: new Date("2024-12-27T00:00:00Z"),
        });

        const categories: AwardsCategory[] = [];
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
        openCategories = categories;
        openPersonalCategory = await categoryRepository.save({
            eventId: openEvent.id,
            name: "Your Game of the Year",
            description: "Personal GOTY",
            order: 0,
            isPersonalGOTY: true,
        });
        closedCategory = await categoryRepository.save({
            eventId: closedEvent.id,
            name: "Closed Category",
            description: "Closed",
            order: 1,
        });
        legacyCategory = await categoryRepository.save({
            eventId: legacyEvent.id,
            name: "Legacy Category",
            description: "Legacy",
            order: 1,
        });

        const moduleRef = await Test.createTestingModule({
            controllers: [AwardsNominationController],
            providers: [
                AwardsNominationService,
                AwardsService,
                {
                    provide: getRepositoryToken(AwardsNomination),
                    useValue: nominationRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategory),
                    useValue: categoryRepository,
                },
                {
                    provide: getRepositoryToken(AwardsEvent),
                    useValue: eventRepository,
                },
                {
                    provide: getRepositoryToken(Game),
                    useValue: source.getRepository(Game),
                },
                { provide: DataSource, useValue: source },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: async (req: {
                            headers: { authorization?: string };
                        }) =>
                            req.headers.authorization === "Bearer user-a"
                                ? { user: { id: USER_A, role: "user" } }
                                : null,
                    },
                },
            ],
        }).compile();

        nominationService = moduleRef.get(AwardsNominationService);
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

    const nowInNominations = new Date("2026-11-10T00:00:00Z");

    it("replaces a user's nominations for one category", async () => {
        await resetOpenNominations(USER_A);

        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [GAME_A, GAME_B],
            nowInNominations,
        );
        expect(await gameIdsFor(USER_A, openCategories[0].id)).toEqual([
            GAME_A,
            GAME_B,
        ]);

        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [GAME_B, GAME_F],
            nowInNominations,
        );
        expect(await gameIdsFor(USER_A, openCategories[0].id)).toEqual([
            GAME_B,
            GAME_F,
        ]);
    });

    it("clears the nominations for a category with an empty list", async () => {
        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [],
            nowInNominations,
        );

        expect(await gameIdsFor(USER_A, openCategories[0].id)).toEqual([]);
    });

    it("rejects more than three games and keeps the existing nominations", async () => {
        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [GAME_A],
            nowInNominations,
        );

        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openCategories[0].id,
                [GAME_A, GAME_B, GAME_F, GAME_NO_RELEASE_DATE],
                nowInNominations,
            ),
        );
        expect(await gameIdsFor(USER_A, openCategories[0].id)).toEqual([
            GAME_A,
        ]);
    });

    it("rejects duplicate game ids", async () => {
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openCategories[0].id,
                [GAME_A, GAME_A],
                nowInNominations,
            ),
        );
    });

    it("rejects nominations for the personal GOTY category", async () => {
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openPersonalCategory.id,
                [GAME_A],
                nowInNominations,
            ),
        );
    });

    it("rejects nominations outside the nominations phase", async () => {
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                closedEvent.id,
                closedCategory.id,
                [GAME_A],
                new Date("2026-01-10T00:00:00Z"),
            ),
        );
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openCategories[0].id,
                [GAME_A],
                new Date("1999-01-01T00:00:00Z"),
            ),
        );
    });

    it("keeps legacy events without a nominations phase", async () => {
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                legacyEvent.id,
                legacyCategory.id,
                [GAME_A],
                new Date("2024-12-05T00:00:00Z"),
            ),
        );
    });

    it("rejects games released outside the year or after the cutoff and accepts no release date", async () => {
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openCategories[0].id,
                [GAME_OUT_OF_YEAR],
                nowInNominations,
            ),
        );
        await expectBadRequest(
            nominationService.replaceNominations(
                USER_A,
                openEvent.id,
                openCategories[0].id,
                [GAME_AFTER_CUTOFF],
                nowInNominations,
            ),
        );

        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [GAME_NO_RELEASE_DATE],
            nowInNominations,
        );
        expect(await gameIdsFor(USER_A, openCategories[0].id)).toEqual([
            GAME_NO_RELEASE_DATE,
        ]);
    });

    it("returns every nominations-enabled category in order with the user's game ids", async () => {
        await resetOpenNominations(USER_A);
        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[0].id,
            [GAME_A, GAME_B],
            nowInNominations,
        );
        await nominationService.replaceNominations(
            USER_A,
            openEvent.id,
            openCategories[1].id,
            [GAME_F],
            nowInNominations,
        );

        const result = await nominationService.getMyNominations(
            USER_A,
            openEvent.id,
        );

        expect(result.map((item) => item.categoryId)).toEqual(
            openCategories.map((category) => category.id),
        );
        expect(result).toHaveLength(11);
        expect(result[0].gameIds).toEqual([GAME_A, GAME_B]);
        expect(result[1].gameIds).toEqual([GAME_F]);
        expect(result.filter((item) => item.gameIds.length === 0)).toHaveLength(
            9,
        );
    });

    it("requires a session for both nomination reads and writes", async () => {
        await request(server())
            .get(`/v1/awards/${openEvent.id}/nominations/me`)
            .expect(401);
        await request(server())
            .put(
                `/v1/awards/${openEvent.id}/nominations/${openCategories[2].id}`,
            )
            .send({ gameIds: [GAME_A] })
            .expect(401);
    });

    it("stores nominations over HTTP and reads them back", async () => {
        await request(server())
            .put(
                `/v1/awards/${openEvent.id}/nominations/${openCategories[2].id}`,
            )
            .set("Authorization", "Bearer user-a")
            .send({ gameIds: [GAME_A, GAME_B] })
            .expect(200);

        expect(await gameIdsFor(USER_A, openCategories[2].id)).toEqual([
            GAME_A,
            GAME_B,
        ]);

        const response = await request(server())
            .get(`/v1/awards/${openEvent.id}/nominations/me`)
            .set("Authorization", "Bearer user-a")
            .expect(200);

        const category = response.body.find(
            (item: { categoryId: number }) =>
                item.categoryId === openCategories[2].id,
        );
        expect(category.gameIds).toEqual([GAME_A, GAME_B]);
    });

    it("returns 400 over HTTP for invalid nominations", async () => {
        const put = (
            categoryId: number,
            body: object,
            eventId = openEvent.id,
        ) =>
            request(server())
                .put(`/v1/awards/${eventId}/nominations/${categoryId}`)
                .set("Authorization", "Bearer user-a")
                .send(body);

        await put(openCategories[2].id, {
            gameIds: [GAME_A, GAME_B, GAME_F, GAME_NO_RELEASE_DATE],
        }).expect(400);
        await put(openCategories[2].id, {
            gameIds: [GAME_A, GAME_A],
        }).expect(400);
        await put(openPersonalCategory.id, { gameIds: [GAME_A] }).expect(400);
        await put(
            closedCategory.id,
            { gameIds: [GAME_A] },
            closedEvent.id,
        ).expect(400);
        await put(openCategories[2].id, {
            gameIds: [GAME_OUT_OF_YEAR],
        }).expect(400);
    });

    it("finalizes nominees once per category from the most-nominated games", async () => {
        const finalEvent = await eventRepository.save({
            year: 2027,
            nominationStartDate: new Date("2027-11-03T00:00:00Z"),
            nominationEndDate: new Date("2027-11-16T00:00:00Z"),
            votingStartDate: new Date("2027-12-01T00:00:00Z"),
            votingEndDate: new Date("2027-12-20T00:00:00Z"),
            resultsDate: new Date("2027-12-27T00:00:00Z"),
        });
        const catTop = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Top",
            description: "Top",
            order: 1,
            nomineeCount: 2,
        });
        const catFew = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Few",
            description: "Few",
            order: 2,
            nomineeCount: 6,
        });
        const catCurated = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Curated",
            description: "Curated",
            order: 3,
            nomineeCount: 2,
        });
        const catEmpty = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Empty",
            description: "Empty",
            order: 4,
            nomineeCount: 6,
        });
        const catNine = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Nine Games",
            description: "Nine Games",
            order: 5,
            nomineeCount: 6,
        });
        const catPersonal = await categoryRepository.save({
            eventId: finalEvent.id,
            name: "Personal",
            description: "Personal",
            order: 0,
            isPersonalGOTY: true,
        });

        for (const gameId of [
            201, 202, 203, 204, 205, 206, 207, 211, 212, 213, 220, 221, 222,
            223, 224, 225, 226, 227, 228,
        ]) {
            await source.query(
                "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
                [gameId, `Final fixture ${gameId}`, `awards-final-${gameId}`],
            );
        }

        await suggestionRepository.save({
            categoryId: catCurated.id,
            gameId: 211,
        });
        await nominationRepository.save([
            // Three games tie at 2 nominations; the two lower ids win the slots.
            {
                categoryId: catTop.id,
                gameId: 201,
                profileUserId: USER_A,
            },
            {
                categoryId: catTop.id,
                gameId: 201,
                profileUserId: USER_B,
            },
            {
                categoryId: catTop.id,
                gameId: 202,
                profileUserId: USER_B,
            },
            {
                categoryId: catTop.id,
                gameId: 202,
                profileUserId: USER_C,
            },
            {
                categoryId: catTop.id,
                gameId: 203,
                profileUserId: USER_A,
            },
            {
                categoryId: catTop.id,
                gameId: 203,
                profileUserId: USER_C,
            },
            // Fewer distinct games than the category has slots.
            { categoryId: catFew.id, gameId: 204, profileUserId: USER_A },
            { categoryId: catFew.id, gameId: 205, profileUserId: USER_B },
            { categoryId: catFew.id, gameId: 206, profileUserId: USER_C },
            { categoryId: catFew.id, gameId: 207, profileUserId: USER_A },
            // An admin already curated this category.
            { categoryId: catCurated.id, gameId: 212, profileUserId: USER_A },
            { categoryId: catCurated.id, gameId: 212, profileUserId: USER_B },
            { categoryId: catCurated.id, gameId: 212, profileUserId: USER_C },
            { categoryId: catCurated.id, gameId: 213, profileUserId: USER_A },
            // Nine distinct games for six slots, ranked by nomination count.
            { categoryId: catNine.id, gameId: 220, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 220, profileUserId: USER_B },
            { categoryId: catNine.id, gameId: 220, profileUserId: USER_C },
            { categoryId: catNine.id, gameId: 221, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 221, profileUserId: USER_B },
            { categoryId: catNine.id, gameId: 222, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 222, profileUserId: USER_C },
            { categoryId: catNine.id, gameId: 223, profileUserId: USER_B },
            { categoryId: catNine.id, gameId: 223, profileUserId: USER_C },
            { categoryId: catNine.id, gameId: 224, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 224, profileUserId: USER_B },
            { categoryId: catNine.id, gameId: 225, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 225, profileUserId: USER_C },
            { categoryId: catNine.id, gameId: 226, profileUserId: USER_A },
            { categoryId: catNine.id, gameId: 227, profileUserId: USER_B },
            { categoryId: catNine.id, gameId: 228, profileUserId: USER_C },
        ]);

        await nominationService.finalizeNominees(finalEvent.id);

        expect(await readSuggestions(catTop.id)).toEqual([201, 202]);
        expect(await readSuggestions(catFew.id)).toEqual([204, 205, 206, 207]);
        expect(await readSuggestions(catCurated.id)).toEqual([211]);
        expect(await readSuggestions(catEmpty.id)).toEqual([]);
        expect(await readSuggestions(catNine.id)).toEqual([
            220, 221, 222, 223, 224, 225,
        ]);

        const finalized = await categoryRepository.findBy({
            eventId: finalEvent.id,
        });
        for (const category of finalized) {
            if (category.id === catPersonal.id) {
                expect(category.nomineesFinalizedAt).toBeNull();
            } else {
                expect(category.nomineesFinalizedAt).not.toBeNull();
            }
        }

        const before = await suggestionRepository.find({
            where: {
                categoryId: In([catTop.id, catFew.id, catCurated.id]),
            },
            order: { id: "ASC" },
        });
        const finalizedAtBefore = finalized
            .map((category) => ({
                id: category.id,
                at: category.nomineesFinalizedAt,
            }))
            .sort((a, b) => a.id - b.id);

        await nominationService.finalizeNominees(finalEvent.id);

        const after = await suggestionRepository.find({
            where: {
                categoryId: In([catTop.id, catFew.id, catCurated.id]),
            },
            order: { id: "ASC" },
        });
        const finalizedAtAfter = (
            await categoryRepository.findBy({ eventId: finalEvent.id })
        )
            .map((category) => ({
                id: category.id,
                at: category.nomineesFinalizedAt,
            }))
            .sort((a, b) => a.id - b.id);
        expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
        expect(finalizedAtAfter).toEqual(finalizedAtBefore);

        const publicCategories = await awardsService.getCategoriesByEventId(
            finalEvent.id,
        );
        const publicTop = publicCategories.find(
            (category) => category.id === catTop.id,
        );
        expect(
            publicTop?.suggestions
                .map((suggestion) => Number(suggestion.gameId))
                .sort((a, b) => a - b),
        ).toEqual([201, 202]);

        const awardsAdminService = new AwardsAdminService(
            eventRepository,
            categoryRepository,
            suggestionRepository,
            awardsService,
        );
        await awardsAdminService.addCategorySuggestion({
            categoryId: catTop.id,
            gameId: 204,
        });
        await awardsAdminService.removeCategorySuggestion({
            categoryId: catTop.id,
            gameId: 201,
        });

        expect(await readSuggestions(catTop.id)).toEqual([202, 204]);

        await nominationService.finalizeNominees(finalEvent.id);
        expect(await readSuggestions(catTop.id)).toEqual([202, 204]);
    });
});
