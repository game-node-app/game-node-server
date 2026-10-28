jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));
import { ImporterService } from "./importer.service";
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { EImporterSource } from "./importer.constants";
import { UserConnection } from "../connection/entity/user-connection.entity";

function fixture(processed: number[] = [], ignored: number[] = []) {
    const connection = {
        id: 1,
        type: EImporterSource.STEAM,
        sourceUserId: "account",
        profileUserId: "owner",
    };
    const find = (ids: number[]) =>
        jest.fn(async () => ids.map((id) => ({ gameExternalGameId: id })));
    const insert = jest.fn();
    const processedRepo = {
        findBy: find(processed),
        insert: jest.fn(),
        manager: {
            getRepository: (entity: unknown) => ({
                findOne: jest
                    .fn()
                    .mockResolvedValue(
                        entity === UserConnection
                            ? connection
                            : { userId: "owner" },
                    ),
            }),
        },
    };
    const ignoredRepo = { findBy: find(ignored), insert };
    const registry = new ConnectionProviderRegistry();
    const service = new ImporterService(
        processedRepo as any,
        ignoredRepo as any,
        {} as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue(connection),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
        {} as any,
        {} as any,
    );
    registry.register({
        ...registry.get("steam"),
        syncHandlers: {
            fetchLibraryGames: jest.fn().mockResolvedValue([
                { id: 1, gameId: 10 },
                { id: 2, gameId: 20 },
            ]),
        },
    });
    return { service, insert };
}

test("batch status deduplicates candidates and treats repeated status as success", async () => {
    const { service, insert } = fixture([], [1]);
    await service.changeStatusBatch("owner", {
        source: EImporterSource.STEAM,
        externalGameIds: [1, 2, 2],
        status: "ignored",
    });
    expect(insert).toHaveBeenCalledWith([
        { libraryUserId: "owner", gameExternalGameId: 2 },
    ]);
});

test("batch status rejects an opposite status or a candidate outside the provider snapshot", async () => {
    const { service, insert } = fixture([1]);
    await expect(
        service.changeStatusBatch("owner", {
            source: EImporterSource.STEAM,
            externalGameIds: [1, 2],
            status: "ignored",
        }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
        service.changeStatusBatch("owner", {
            source: EImporterSource.STEAM,
            externalGameIds: [3],
            status: "ignored",
        }),
    ).rejects.toMatchObject({ status: 400 });
    expect(insert).not.toHaveBeenCalled();
});
