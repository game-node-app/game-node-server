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
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { AwardsController } from "./awards.controller";
import { AwardsService } from "./awards.service";
import { AwardsAdminController } from "./admin/awards-admin.controller";
import { AwardsAdminService } from "./admin/awards-admin.service";
import { AwardsEvent } from "./entity/awards-event.entity";
import { AwardsCategory } from "./entity/awards-category.entity";
import { AwardsCategorySuggestion } from "./entity/awards-category-suggestion.entity";
import { AwardsCategoryTranslation } from "./entity/awards-category-translation.entity";
import { AwardsResultService } from "./result/awards-result.service";
import { AuthService } from "../auth/auth.service";

const DATABASE = "awards_events_test";
const ADMIN_ID = "00000000-0000-0000-0000-0000000000ad";

jest.setTimeout(120000);

describe("Awards events calendar and current event", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let app: INestApplication;
    let awardsService: AwardsService;
    let eventRepository: Repository<AwardsEvent>;
    let seeded: { event2026: AwardsEvent; event2027: AwardsEvent };

    const server = () => app.getHttpServer();

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;
        eventRepository = source.getRepository(AwardsEvent);

        const moduleRef = await Test.createTestingModule({
            controllers: [AwardsController, AwardsAdminController],
            providers: [
                AwardsService,
                AwardsAdminService,
                { provide: DataSource, useValue: source },
                {
                    provide: AwardsResultService,
                    useValue: { getCategoryResultsByEventId: jest.fn() },
                },
                {
                    provide: getRepositoryToken(AwardsEvent),
                    useValue: eventRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategory),
                    useValue: source.getRepository(AwardsCategory),
                },
                {
                    provide: getRepositoryToken(AwardsCategorySuggestion),
                    useValue: source.getRepository(AwardsCategorySuggestion),
                },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: async (req: {
                            headers: { authorization?: string };
                        }) =>
                            req.headers.authorization === "Bearer admin"
                                ? {
                                      user: { id: ADMIN_ID, role: "admin" },
                                  }
                                : null,
                    },
                },
            ],
        }).compile();

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

    const seedEvents = async () => {
        const event2026 = await eventRepository.save({
            year: 2026,
            nominationStartDate: new Date("2026-11-03T00:00:00Z"),
            nominationEndDate: new Date("2026-11-16T00:00:00Z"),
            votingStartDate: new Date("2026-12-01T00:00:00Z"),
            votingEndDate: new Date("2026-12-20T00:00:00Z"),
            resultsDate: new Date("2026-12-27T00:00:00Z"),
            eligibilityCutoffDate: new Date("2026-11-30T00:00:00Z"),
        });
        const event2027 = await eventRepository.save({
            year: 2027,
            nominationStartDate: new Date("2027-11-03T00:00:00Z"),
            nominationEndDate: new Date("2027-11-16T00:00:00Z"),
            votingStartDate: new Date("2027-12-01T00:00:00Z"),
            votingEndDate: new Date("2027-12-20T00:00:00Z"),
            resultsDate: new Date("2027-12-27T00:00:00Z"),
        });
        const categoryRepository = source.getRepository(AwardsCategory);
        const [gotyCategory] = await categoryRepository.save([
            {
                eventId: event2026.id,
                name: "Game of the Year",
                description: "GOTY",
                order: 1,
            },
            {
                eventId: event2026.id,
                name: "Narrativa",
                description: "Story",
                order: 2,
            },
        ]);
        await source.getRepository(AwardsCategoryTranslation).save({
            categoryId: gotyCategory.id,
            locale: "en",
            name: "Game of the Year (EN)",
            description: "GOTY (EN)",
        });
        seeded = { event2026, event2027 };
    };

    it("returns 404 while no event has started", async () => {
        await request(server()).get("/v1/awards/events/current").expect(404);
    });

    it("returns the latest started event with its dates, phase and categories count", async () => {
        await seedEvents();

        const current = await awardsService.getCurrentEvent(
            new Date("2027-01-10T12:00:00Z"),
        );

        expect(current?.id).toBe(seeded.event2026.id);
        expect(current?.year).toBe(2026);
        expect(current?.phase).toBe("results");
        expect(current?.categoriesCount).toBe(2);
        expect(current?.nominationStartDate).toEqual(
            seeded.event2026.nominationStartDate,
        );
        expect(current?.votingStartDate).toEqual(
            seeded.event2026.votingStartDate,
        );
    });

    it("ignores a future event and keeps the latest started one", async () => {
        const november = await awardsService.getCurrentEvent(
            new Date("2026-11-15T00:00:00Z"),
        );

        expect(november?.id).toBe(seeded.event2026.id);
        expect(november?.id).not.toBe(seeded.event2027.id);
        expect(november?.phase).toBe("nominations");
    });

    it("serves GET /events/current publicly with the categories count", async () => {
        const response = await request(server())
            .get("/v1/awards/events/current")
            .expect(200);

        expect(response.body.id).toBe(seeded.event2026.id);
        expect(response.body.phase).toBeDefined();
        expect(response.body.categoriesCount).toBe(2);
        expect(response.body.nominationEndDate).toBeDefined();
    });

    it("keeps GET /events/:id resolving, now with phase", async () => {
        const response = await request(server())
            .get(`/v1/awards/events/${seeded.event2026.id}`)
            .expect(200);

        expect(response.body.id).toBe(seeded.event2026.id);
        expect(response.body.phase).toBeDefined();
    });

    it("adds phase to every event read", async () => {
        const events = await awardsService.getEvents();
        const byId = await awardsService.getEventByIdOrFail(
            seeded.event2026.id,
        );
        const byYear = await awardsService.getEventByYearOrFail(2026);

        expect(events.map((event) => event.id)).toEqual(
            expect.arrayContaining([seeded.event2026.id, seeded.event2027.id]),
        );
        expect(events.every((event) => event.phase != null)).toBe(true);
        expect(byId.phase).toBeDefined();
        expect(byYear.phase).toBeDefined();
    });

    it("returns saved category translations, and [] for categories without any", async () => {
        const response = await request(server())
            .get(`/v1/awards/${seeded.event2026.id}/categories`)
            .expect(200);

        const goty = response.body.find(
            (category: { name: string }) =>
                category.name === "Game of the Year",
        );
        expect(goty.name).toBe("Game of the Year");
        expect(goty.description).toBe("GOTY");
        expect(goty.translations).toMatchObject([
            {
                locale: "en",
                name: "Game of the Year (EN)",
                description: "GOTY (EN)",
            },
        ]);

        const narrative = response.body.find(
            (category: { name: string }) => category.name === "Narrativa",
        );
        expect(narrative.translations).toEqual([]);
    });

    it("rejects an admin save with out-of-order dates over HTTP and stores nothing", async () => {
        await request(server())
            .post("/v1/awards/admin/event")
            .send({
                year: 2031,
                votingStartDate: "2031-12-01T00:00:00.000Z",
                votingEndDate: "2031-12-20T00:00:00.000Z",
                resultsDate: "2031-12-27T00:00:00.000Z",
                nominationStartDate: "2031-11-03T00:00:00.000Z",
                nominationEndDate: "2031-12-05T00:00:00.000Z",
            })
            .expect(401);

        await request(server())
            .post("/v1/awards/admin/event")
            .set("Authorization", "Bearer admin")
            .send({
                year: 2031,
                votingStartDate: "2031-12-01T00:00:00.000Z",
                votingEndDate: "2031-12-20T00:00:00.000Z",
                resultsDate: "2031-12-27T00:00:00.000Z",
                nominationStartDate: "2031-11-03T00:00:00.000Z",
                nominationEndDate: "2031-12-05T00:00:00.000Z",
            })
            .expect(400);

        await request(server())
            .post("/v1/awards/admin/event")
            .set("Authorization", "Bearer admin")
            .send({
                year: 2031,
                votingStartDate: "2031-12-20T00:00:00.000Z",
                votingEndDate: "2031-12-01T00:00:00.000Z",
                resultsDate: "2031-12-27T00:00:00.000Z",
            })
            .expect(400);

        expect(await eventRepository.countBy({ year: 2031 })).toBe(0);
    });

    it("stores all five dates of a valid admin calendar", async () => {
        await request(server())
            .post("/v1/awards/admin/event")
            .set("Authorization", "Bearer admin")
            .send({
                year: 2032,
                votingStartDate: "2032-12-01T00:00:00.000Z",
                votingEndDate: "2032-12-20T00:00:00.000Z",
                resultsDate: "2032-12-27T00:00:00.000Z",
                nominationStartDate: "2032-11-03T00:00:00.000Z",
                nominationEndDate: "2032-11-16T00:00:00.000Z",
            })
            .expect(201);

        const stored = await eventRepository.findOneByOrFail({ year: 2032 });
        expect(stored.votingStartDate).toEqual(
            new Date("2032-12-01T00:00:00Z"),
        );
        expect(stored.votingEndDate).toEqual(new Date("2032-12-20T00:00:00Z"));
        expect(stored.resultsDate).toEqual(new Date("2032-12-27T00:00:00Z"));
        expect(stored.nominationStartDate).toEqual(
            new Date("2032-11-03T00:00:00Z"),
        );
        expect(stored.nominationEndDate).toEqual(
            new Date("2032-11-16T00:00:00Z"),
        );
    });
});
