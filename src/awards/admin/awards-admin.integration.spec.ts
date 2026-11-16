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
import { DataSource, EntityManager, Repository } from "typeorm";
import request from "supertest";
import { createAwardsTestDatabase } from "../../../test/awards/awards-test-database";
import { AwardsAdminController } from "./awards-admin.controller";
import { AwardsAdminService } from "./awards-admin.service";
import { AwardsService } from "../awards.service";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { AwardsCategoryTranslation } from "../entity/awards-category-translation.entity";
import { AuthService } from "../../auth/auth.service";

const DATABASE = "awards_admin_translations_test";
const ADMIN_ID = "00000000-0000-0000-0000-0000000000ad";

jest.setTimeout(120000);

describe("Awards admin category translations", () => {
    let cleanup: () => Promise<void>;
    let source: DataSource;
    let app: INestApplication;
    let categoryRepository: Repository<AwardsCategory>;
    let translationRepository: Repository<AwardsCategoryTranslation>;

    const server = () => app.getHttpServer();

    const postCategory = (body: Record<string, unknown>) =>
        request(server())
            .post("/v1/awards/admin/category")
            .set("Authorization", "Bearer admin")
            .send(body);

    const category = (name: string) => ({
        year: 2026,
        name,
        description: "Base description",
        order: 1,
    });

    const en = {
        locale: "en",
        name: "Narrative",
        description: "Story",
    };
    const ptBr = {
        locale: "pt-BR",
        name: "Narrativa",
        description: "História",
    };

    const storedTranslations = async (categoryId: number) =>
        (
            await translationRepository.find({
                where: { categoryId },
                order: { locale: "ASC" },
            })
        ).map(({ locale, name, description }) => ({
            locale,
            name,
            description,
        }));

    beforeAll(async () => {
        const database = await createAwardsTestDatabase(DATABASE);
        cleanup = database.destroy;
        source = database.source;
        categoryRepository = source.getRepository(AwardsCategory);
        translationRepository = source.getRepository(AwardsCategoryTranslation);
        await source.getRepository(AwardsEvent).save({
            year: 2026,
            votingStartDate: new Date("2026-12-01T00:00:00Z"),
            votingEndDate: new Date("2026-12-20T00:00:00Z"),
            resultsDate: new Date("2026-12-27T00:00:00Z"),
        });

        const moduleRef = await Test.createTestingModule({
            controllers: [AwardsAdminController],
            providers: [
                AwardsService,
                AwardsAdminService,
                {
                    provide: getRepositoryToken(AwardsEvent),
                    useValue: source.getRepository(AwardsEvent),
                },
                {
                    provide: getRepositoryToken(AwardsCategory),
                    useValue: categoryRepository,
                },
                {
                    provide: getRepositoryToken(AwardsCategorySuggestion),
                    useValue: source.getRepository(AwardsCategorySuggestion),
                },
                {
                    provide: DataSource,
                    useValue: source,
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

    it.each([
        [
            "an empty description",
            [{ locale: "en", name: "Best Indie", description: "" }],
        ],
        [
            "an empty name",
            [{ locale: "en", name: "", description: "Descrição" }],
        ],
        ["a missing name", [{ locale: "en", description: "Descrição" }]],
        ["a missing description", [{ locale: "en", name: "Best Indie" }]],
        [
            "a numeric name",
            [{ locale: "en", name: 42, description: "Descrição" }],
        ],
        [
            "a boolean name",
            [{ locale: "en", name: false, description: "Descrição" }],
        ],
        [
            "an object name",
            [
                {
                    locale: "en",
                    name: { text: "Best Indie" },
                    description: "Descrição",
                },
            ],
        ],
        [
            "a numeric description",
            [{ locale: "en", name: "Best Indie", description: 42 }],
        ],
        [
            "a boolean description",
            [{ locale: "en", name: "Best Indie", description: false }],
        ],
        [
            "an object description",
            [
                {
                    locale: "en",
                    name: "Best Indie",
                    description: { text: "Story" },
                },
            ],
        ],
        [
            "an unsupported locale",
            [{ locale: "es", name: "Mejor Indie", description: "Descripción" }],
        ],
        [
            "duplicate locales",
            [
                { locale: "en", name: "Best Indie", description: "First" },
                { locale: "en", name: "Best Indie 2", description: "Second" },
            ],
        ],
    ])(
        "rejects %s with 400 and stores nothing",
        async (label, translations) => {
            const name = `Invalid ${label}`;

            await postCategory({ ...category(name), translations }).expect(400);

            expect(await categoryRepository.countBy({ name })).toBe(0);
        },
    );

    it("rejects an invalid update without changing the stored category", async () => {
        const name = "Unchanged category";
        await postCategory({ ...category(name), translations: [en] }).expect(
            201,
        );
        const stored = await categoryRepository.findOneByOrFail({ name });

        await postCategory({
            ...category(name),
            categoryId: stored.id,
            name: "Renamed",
            order: 5,
            translations: [en, en],
        }).expect(400);

        const unchanged = await categoryRepository.findOneByOrFail({
            id: stored.id,
        });
        expect(unchanged.name).toBe(name);
        expect(unchanged.order).toBe(1);
        expect(await storedTranslations(stored.id)).toEqual([en]);
    });

    it.each([
        ["a numeric name", { ...en, name: 42 }],
        ["a boolean description", { ...en, description: false }],
    ])(
        "rejects %s on update without changing the stored category",
        async (label, invalidTranslation) => {
            const name = `Typed update ${label}`;
            await postCategory({
                ...category(name),
                translations: [en, ptBr],
            }).expect(201);
            const stored = await categoryRepository.findOneByOrFail({ name });

            await postCategory({
                ...category(name),
                categoryId: stored.id,
                name: "Renamed",
                order: 5,
                translations: [invalidTranslation],
            }).expect(400);

            const unchanged = await categoryRepository.findOneByOrFail({
                id: stored.id,
            });
            expect(unchanged.name).toBe(name);
            expect(unchanged.order).toBe(1);
            expect(await storedTranslations(stored.id)).toEqual([en, ptBr]);
        },
    );

    it("stores both locales and replaces the set with only the submitted locale", async () => {
        const name = "Replacement category";
        await postCategory({
            ...category(name),
            translations: [en, ptBr],
        }).expect(201);
        const stored = await categoryRepository.findOneByOrFail({ name });
        expect(await storedTranslations(stored.id)).toEqual([en, ptBr]);

        const updatedPtBr = {
            locale: "pt-BR",
            name: "Narrativa atualizada",
            description: "História atualizada",
        };
        await postCategory({
            ...category(name),
            categoryId: stored.id,
            translations: [updatedPtBr],
        }).expect(201);

        expect(await storedTranslations(stored.id)).toEqual([updatedPtBr]);
    });

    it("keeps translations when the update omits them", async () => {
        const name = "Kept category";
        await postCategory({
            ...category(name),
            translations: [en, ptBr],
        }).expect(201);
        const stored = await categoryRepository.findOneByOrFail({ name });

        await postCategory({
            ...category(name),
            categoryId: stored.id,
            order: 7,
        }).expect(201);

        expect(
            (await categoryRepository.findOneByOrFail({ id: stored.id })).order,
        ).toBe(7);
        expect(await storedTranslations(stored.id)).toEqual([en, ptBr]);
    });

    it("clears translations for an empty array", async () => {
        const name = "Cleared category";
        await postCategory({
            ...category(name),
            translations: [en, ptBr],
        }).expect(201);
        const stored = await categoryRepository.findOneByOrFail({ name });

        await postCategory({
            ...category(name),
            categoryId: stored.id,
            translations: [],
        }).expect(201);

        expect(await storedTranslations(stored.id)).toEqual([]);
    });

    it("rolls back the replacement when the insert fails", async () => {
        const name = "Atomic category";
        await postCategory({
            ...category(name),
            translations: [en, ptBr],
        }).expect(201);
        const stored = await categoryRepository.findOneByOrFail({ name });

        const originalInsert = EntityManager.prototype.insert;
        const insertSpy = jest
            .spyOn(EntityManager.prototype, "insert")
            .mockImplementation(async function (
                this: EntityManager,
                target: unknown,
                entity: unknown,
                options?: unknown,
            ) {
                if (target === AwardsCategoryTranslation) {
                    throw new Error("injected failure");
                }
                return (originalInsert as any).call(
                    this,
                    target,
                    entity,
                    options,
                );
            } as any);

        try {
            await postCategory({
                ...category(name),
                categoryId: stored.id,
                order: 9,
                translations: [
                    {
                        locale: "pt-BR",
                        name: "Alterada",
                        description: "Alterada",
                    },
                ],
            }).expect(500);
        } finally {
            insertSpy.mockRestore();
        }

        expect(
            (await categoryRepository.findOneByOrFail({ id: stored.id })).order,
        ).toBe(1);
        expect(await storedTranslations(stored.id)).toEqual([en, ptBr]);
    });
});
