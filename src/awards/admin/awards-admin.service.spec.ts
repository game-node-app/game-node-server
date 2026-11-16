jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));

import { HttpException } from "@nestjs/common";
import { AwardsAdminService } from "./awards-admin.service";
import { CreateUpdateAwardsEventDto } from "../dto/create-update-awards-event.dto";
import { CreateUpdateAwardsCategoryDto } from "../dto/create-update-awards-category.dto";
import { AwardsCategoryTranslation } from "../entity/awards-category-translation.entity";
import { AwardsCategory } from "../entity/awards-category.entity";

function fixture() {
    const events = {
        save: jest.fn(async (entity) => ({ id: 1, ...entity })),
    };
    const categories = {
        save: jest.fn(async (entity) => ({ id: 1, ...entity })),
    };
    const suggestions = { save: jest.fn(), findOneByOrFail: jest.fn() };
    const manager = {
        save: jest.fn(async (_target, entity) => ({
            ...entity,
            id: entity.id ?? 1,
        })),
        delete: jest.fn(),
        insert: jest.fn(),
    };
    const dataSource = {
        transaction: jest.fn(async (run: (manager: any) => void) =>
            run(manager),
        ),
    };
    const awardsService = {
        getEventByYear: jest.fn().mockResolvedValue(undefined),
        getEventById: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AwardsAdminService(
        events as any,
        categories as any,
        suggestions as any,
        awardsService as any,
        dataSource as any,
    );
    return {
        service,
        events,
        categories,
        suggestions,
        manager,
        dataSource,
        awardsService,
    };
}

const calendar: CreateUpdateAwardsEventDto = {
    year: 2026,
    votingStartDate: new Date("2026-12-01T00:00:00Z"),
    votingEndDate: new Date("2026-12-20T00:00:00Z"),
    resultsDate: new Date("2026-12-27T00:00:00Z"),
    nominationStartDate: new Date("2026-11-03T00:00:00Z"),
    nominationEndDate: new Date("2026-11-16T00:00:00Z"),
};

describe("AwardsAdminService event dates", () => {
    it.each([
        { votingEndDate: new Date("2026-11-30T00:00:00Z") },
        { votingEndDate: calendar.votingStartDate },
        { resultsDate: new Date("2026-12-19T00:00:00Z") },
    ])("rejects an out-of-order voting/results calendar: %j", async (dates) => {
        const { service, events } = fixture();
        await expect(
            service.createAwardsEvent({ ...calendar, ...dates }),
        ).rejects.toMatchObject({ status: 400 });
        expect(events.save).not.toHaveBeenCalled();
    });

    it("stores the five dates of a valid calendar", async () => {
        const { service, events } = fixture();

        await service.createAwardsEvent(calendar);

        expect(events.save).toHaveBeenCalledWith(
            expect.objectContaining({
                votingStartDate: calendar.votingStartDate,
                votingEndDate: calendar.votingEndDate,
                resultsDate: calendar.resultsDate,
                nominationStartDate: calendar.nominationStartDate,
                nominationEndDate: calendar.nominationEndDate,
            }),
        );
    });

    it("rejects nominations ending after voting starts with 400 and saves nothing", async () => {
        const { service, events } = fixture();

        let error: unknown;
        try {
            await service.createAwardsEvent({
                ...calendar,
                nominationEndDate: new Date("2026-12-05T00:00:00Z"),
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(400);
        expect(events.save).not.toHaveBeenCalled();
    });

    it("accepts nominations ending exactly when voting starts", async () => {
        const { service, events } = fixture();

        await service.createAwardsEvent({
            ...calendar,
            nominationEndDate: calendar.votingStartDate,
        });

        expect(events.save).toHaveBeenCalled();
    });

    it("rejects only one of the two nomination dates", async () => {
        const { service, events } = fixture();

        await expect(
            service.createAwardsEvent({
                ...calendar,
                nominationEndDate: null,
            }),
        ).rejects.toThrow(HttpException);
        expect(events.save).not.toHaveBeenCalled();
    });

    it("rejects an update whose new voting start falls before the stored nomination end", async () => {
        const { service, events, awardsService } = fixture();
        awardsService.getEventById.mockResolvedValue({
            id: 5,
            year: 2026,
            nominationStartDate: new Date("2026-11-03T00:00:00Z"),
            nominationEndDate: new Date("2026-12-05T00:00:00Z"),
        });

        await expect(
            service.createAwardsEvent({
                eventId: 5,
                year: 2026,
                votingStartDate: new Date("2026-12-01T00:00:00Z"),
                votingEndDate: new Date("2026-12-20T00:00:00Z"),
                resultsDate: new Date("2026-12-27T00:00:00Z"),
            }),
        ).rejects.toThrow(HttpException);
        expect(events.save).not.toHaveBeenCalled();
    });

    it("validates a year change against the stored event, not the target year", async () => {
        const { service, events, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue(undefined);
        awardsService.getEventById.mockResolvedValue({
            id: 5,
            year: 2026,
            nominationStartDate: new Date("2026-11-03T00:00:00Z"),
            nominationEndDate: new Date("2026-12-05T00:00:00Z"),
        });

        await expect(
            service.createAwardsEvent({
                eventId: 5,
                year: 2027,
                votingStartDate: new Date("2026-12-01T00:00:00Z"),
                votingEndDate: new Date("2026-12-20T00:00:00Z"),
                resultsDate: new Date("2026-12-27T00:00:00Z"),
            }),
        ).rejects.toThrow(HttpException);
        expect(events.save).not.toHaveBeenCalled();
    });

    it("keeps saving legacy events without nomination dates", async () => {
        const { service, events } = fixture();

        await service.createAwardsEvent({
            year: 2025,
            votingStartDate: new Date("2025-12-01T00:00:00Z"),
            votingEndDate: new Date("2025-12-20T00:00:00Z"),
            resultsDate: new Date("2025-12-27T00:00:00Z"),
        });

        expect(events.save).toHaveBeenCalledWith(
            expect.objectContaining({
                year: 2025,
                votingStartDate: new Date("2025-12-01T00:00:00Z"),
            }),
        );
        expect(events.save.mock.calls[0][0]).not.toHaveProperty(
            "nominationStartDate",
        );
        expect(events.save.mock.calls[0][0]).not.toHaveProperty(
            "nominationEndDate",
        );
    });
});

describe("AwardsAdminService category nomineeCount", () => {
    it("preserves the GOTY flags when editing a special category", async () => {
        const { service, manager, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue({ id: 10, year: 2026 });
        await service.createOrUpdateAwardsCategory({ ...dto, categoryId: 1 });
        expect(manager.save.mock.calls[0][1]).not.toHaveProperty("isGOTY");
        expect(manager.save.mock.calls[0][1]).not.toHaveProperty(
            "isPersonalGOTY",
        );
    });

    const dto: CreateUpdateAwardsCategoryDto = {
        year: 2026,
        name: "Narrativa",
        description: "Story",
        order: 2,
        nomineeCount: 4,
    };

    it("stores nomineeCount with the category", async () => {
        const { service, manager, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue({ id: 10, year: 2026 });

        await service.createOrUpdateAwardsCategory(dto);

        expect(manager.save).toHaveBeenCalledWith(
            AwardsCategory,
            expect.objectContaining({ nomineeCount: 4, eventId: 10 }),
        );
    });
});

describe("AwardsAdminService category translations", () => {
    const category: CreateUpdateAwardsCategoryDto = {
        year: 2026,
        name: "Narrativa",
        description: "Story",
        order: 2,
    };

    it("rejects duplicate locales with 400 before writing", async () => {
        const { service, dataSource } = fixture();

        await expect(
            service.createOrUpdateAwardsCategory({
                ...category,
                translations: [
                    { locale: "en", name: "Narrative", description: "Story" },
                    { locale: "en", name: "Narrative 2", description: "Story" },
                ],
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it("leaves translations untouched when the field is omitted", async () => {
        const { service, manager, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue({ id: 10, year: 2026 });

        await service.createOrUpdateAwardsCategory(category);

        expect(manager.delete).not.toHaveBeenCalled();
        expect(manager.insert).not.toHaveBeenCalled();
    });

    it("replaces the set with the submitted translations", async () => {
        const { service, manager, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue({ id: 10, year: 2026 });

        await service.createOrUpdateAwardsCategory({
            ...category,
            categoryId: 3,
            translations: [
                {
                    locale: "pt-BR",
                    name: "Narrativa",
                    description: "História",
                },
            ],
        });

        expect(manager.delete).toHaveBeenCalledWith(AwardsCategoryTranslation, {
            categoryId: 3,
        });
        expect(manager.insert).toHaveBeenCalledWith(AwardsCategoryTranslation, [
            {
                categoryId: 3,
                locale: "pt-BR",
                name: "Narrativa",
                description: "História",
            },
        ]);
    });

    it("clears translations for an empty array", async () => {
        const { service, manager, awardsService } = fixture();
        awardsService.getEventByYear.mockResolvedValue({ id: 10, year: 2026 });

        await service.createOrUpdateAwardsCategory({
            ...category,
            categoryId: 3,
            translations: [],
        });

        expect(manager.delete).toHaveBeenCalledWith(AwardsCategoryTranslation, {
            categoryId: 3,
        });
        expect(manager.insert).not.toHaveBeenCalled();
    });
});
