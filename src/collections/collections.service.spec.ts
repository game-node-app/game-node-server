import { Global, HttpException, HttpStatus, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { AuthService } from "../auth/auth.service";
import { BillingModule } from "../billing/billing.module";
import { BillingService } from "../billing/billing.service";
import { Library } from "../libraries/entities/library.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { CollectionsEntriesModule } from "./collections-entries/collections-entries.module";
import { CollectionsModule } from "./collections.module";
import { CollectionsService } from "./collections.service";
import { Collection } from "./entities/collection.entity";

const createDto = { name: "Favorites" };

function fixture(count: number, isSupporter = jest.fn(async () => false)) {
    const collectionsRepository = {
        count: jest.fn().mockResolvedValue(count),
        create: jest.fn((entity) => entity),
        save: jest.fn(async (entity) => entity),
    };
    const libraryRepository = {
        findOne: jest.fn().mockResolvedValue({ userId: "owner" }),
    };
    const manager: any = {
        getRepository: jest.fn((entity: unknown) =>
            entity === Library ? libraryRepository : collectionsRepository,
        ),
        transaction: jest.fn(async (callback: (manager: any) => unknown) =>
            callback(manager),
        ),
    };
    const service = new CollectionsService(
        { manager } as any,
        { isSupporter } as any,
    );

    return {
        service,
        collectionsRepository,
        libraryRepository,
        isSupporter,
    };
}

describe("CollectionsService.create limit", () => {
    it("creates below the limit without consulting entitlement", async () => {
        const { service, collectionsRepository, isSupporter } = fixture(4);

        await service.create("owner", createDto);

        expect(collectionsRepository.count).toHaveBeenCalledWith({
            where: { libraryUserId: "owner" },
        });
        expect(collectionsRepository.save).toHaveBeenCalledTimes(1);
        expect(isSupporter).not.toHaveBeenCalled();
    });

    it("rejects a free user at the limit with the limit contract and saves nothing", async () => {
        const { service, collectionsRepository } = fixture(5);

        const error = await service
            .create("owner", createDto)
            .catch((thrown) => thrown);

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(error.getResponse()).toEqual({
            message: "Collection limit reached.",
            code: "collection_limit_reached",
            limit: 5,
        });
        expect(collectionsRepository.save).not.toHaveBeenCalled();
    });

    it("creates for a supporter at the limit", async () => {
        const { service, collectionsRepository } = fixture(
            5,
            jest.fn(async () => true),
        );

        await service.create("owner", createDto);

        expect(collectionsRepository.save).toHaveBeenCalledTimes(1);
    });

    it("creates for a supporter far above the limit", async () => {
        const { service, collectionsRepository } = fixture(
            500,
            jest.fn(async () => true),
        );

        await service.create("owner", createDto);

        expect(collectionsRepository.save).toHaveBeenCalledTimes(1);
    });

    it("rejects a lapsed supporter above the free limit and saves nothing", async () => {
        const { service, collectionsRepository } = fixture(50);

        const error = await service
            .create("owner", createDto)
            .catch((thrown) => thrown);

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(error.getResponse()).toMatchObject({
            code: "collection_limit_reached",
            limit: 5,
        });
        expect(collectionsRepository.save).not.toHaveBeenCalled();
    });

    it("propagates an entitlement failure at the limit and saves nothing", async () => {
        const failure = new Error("billing unavailable");
        const { service, collectionsRepository } = fixture(
            5,
            jest.fn().mockRejectedValue(failure),
        );

        await expect(service.create("owner", createDto)).rejects.toBe(failure);
        expect(collectionsRepository.save).not.toHaveBeenCalled();
    });

    it("locks the owner's library row inside the transaction", async () => {
        const { service, libraryRepository } = fixture(4);

        await service.create("owner", createDto);

        expect(libraryRepository.findOne).toHaveBeenCalledWith({
            where: { userId: "owner" },
            lock: { mode: "pessimistic_write" },
        });
    });

    it("keeps the featured collections validation", async () => {
        const { service, collectionsRepository } = fixture(0);

        const error = await service
            .create("owner", {
                name: "Featured",
                isFeatured: true,
                isPublic: false,
            })
            .catch((thrown) => thrown);

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(collectionsRepository.save).not.toHaveBeenCalled();
    });

    it("returns 404 when the library is missing", async () => {
        const { service, libraryRepository, collectionsRepository } =
            fixture(0);
        libraryRepository.findOne.mockResolvedValue(null);

        const error = await service
            .create("owner", createDto)
            .catch((thrown) => thrown);

        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect(collectionsRepository.save).not.toHaveBeenCalled();
    });
});

const dataSource = {
    options: { type: "mysql" },
    entityMetadatas: [],
    getRepository: jest.fn((entity) => ({ target: entity })),
};

@Global()
@Module({
    providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: { getSession: jest.fn() } },
        {
            provide: ConfigService,
            useValue: { get: jest.fn(), getOrThrow: jest.fn(() => "http://x") },
        },
    ],
    exports: [DataSource, AuthService, ConfigService],
})
class FixtureModule {}

@Module({})
class EmptyModule {}

test("CollectionsModule resolves with BillingModule and no provider cycle", async () => {
    const module = await Test.createTestingModule({
        imports: [FixtureModule, CollectionsModule],
    })
        .overrideModule(CollectionsEntriesModule)
        .useModule(EmptyModule)
        .overrideModule(NotificationsModule)
        .useModule(EmptyModule)
        .compile();

    try {
        expect(module.get(CollectionsService)).toBeInstanceOf(
            CollectionsService,
        );
        expect(module.get(BillingService)).toBeInstanceOf(BillingService);
        expect(module.get(getRepositoryToken(Collection))).toEqual({
            target: Collection,
        });
    } finally {
        await module.close();
    }
});
