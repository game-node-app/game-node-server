import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource, Table } from "typeorm";
import { Queue, Worker } from "bullmq";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { AddConnectionAuth1792886400003 } from "../migrations/1792886400003-AddConnectionAuth";
import { CreatePlayerConnectionSync1792886400000 } from "../migrations/1792886400000-CreatePlayerConnectionSync";
import { ConnectionAuthStateService } from "./connection-auth-state.service";
import { ConnectionCredentialCryptoService } from "./connection-credential-crypto.service";
import { ConnectionCredentialService } from "./connection-credential.service";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { ConnectionsService } from "./connections.service";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "./connections.constants";
import { UserConnection } from "./entity/user-connection.entity";
import { UserConnectionCredential } from "./entity/user-connection-credential.entity";
import { PlayerSyncStateService } from "../sync/player-data/player-sync-state.service";
import { PlayerConnectionSync } from "../sync/player-data/entity/player-connection-sync.entity";
import { PlayerGameSync } from "../sync/player-data/entity/player-game-sync.entity";
import { PlayerDataProcessor } from "../sync/player-data/player-data.processor";
import { PLAYER_DATA_JOB } from "../sync/player-data/player-data.constants";
import { ProviderSyncError } from "../sync/provider-sync.error";
import { XboxSyncAuthService } from "../sync/xbox/auth/xbox-sync-auth.service";

const integrationDescribe =
    process.env.PLAYER_IMPORT_TEST_MYSQL_PORT &&
    process.env.PLAYER_IMPORT_TEST_REDIS_PORT
        ? describe
        : describe.skip;

integrationDescribe("connection auth on disposable MySQL and Redis", () => {
    const database = `player_import_test_${randomUUID().replaceAll("-", "")}`;
    const redisConnection = {
        host: "127.0.0.1",
        port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
        maxRetriesPerRequest: null,
    };
    let source: DataSource;
    let admin: DataSource;
    let queue: Queue;
    let credentials: ConnectionCredentialService;
    let state: PlayerSyncStateService;

    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        const options = {
            type: "mysql" as const,
            host: "127.0.0.1",
            port: Number(process.env.PLAYER_IMPORT_TEST_MYSQL_PORT),
            username: "root",
            password: "",
            timezone: "Z",
        };
        admin = await new DataSource(options).initialize();
        await admin.query(`CREATE DATABASE \`${database}\``);
        source = await new DataSource({
            ...options,
            database,
            entities: [resolve(__dirname, "..", "**/*.entity.ts")],
        }).initialize();
        addTransactionalDataSource(source);
        const runner = source.createQueryRunner();
        try {
            const connectionTable = Table.create(
                source.getMetadata(UserConnection),
                source.driver,
            );
            connectionTable.columns = connectionTable.columns.filter(
                (column) => column.name !== "authStatus",
            );
            await runner.createTable(connectionTable, false, false);
            await new AddConnectionAuth1792886400003().up(runner);
            await new CreatePlayerConnectionSync1792886400000().up(runner);
            await runner.createTable(
                Table.create(source.getMetadata(PlayerGameSync), source.driver),
                false,
                false,
            );
        } finally {
            await runner.release();
        }
        queue = new Queue(`connection-auth-test-${randomUUID()}`, {
            connection: redisConnection,
        });
        const crypto = new ConnectionCredentialCryptoService();
        crypto.initializeKey("ab".repeat(32));
        credentials = new ConnectionCredentialService(
            source.getRepository(UserConnectionCredential),
            crypto,
        );
        state = new PlayerSyncStateService(source);
    });

    afterAll(async () => {
        if (queue) {
            await queue.obliterate({ force: true });
            await queue.close();
        }
        if (source?.isInitialized) {
            deleteDataSourceByName(source.name);
            await source.destroy();
        }
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE \`${database}\``);
            await admin.destroy();
        }
    });

    const createConnection = () =>
        source.getRepository(UserConnection).save({
            profileUserId: randomUUID(),
            type: EConnectionType.XBOX,
            sourceUserId: randomUUID(),
            sourceUsername: "fixture",
        });

    it("runs migration rollback and cascades encrypted credentials on deletion", async () => {
        const runner = source.createQueryRunner();
        try {
            await new AddConnectionAuth1792886400003().down(runner);
            expect(
                await runner.hasColumn("user_connection", "authStatus"),
            ).toBe(false);
            expect(await runner.hasTable("user_connection_credential")).toBe(
                false,
            );
            await new AddConnectionAuth1792886400003().up(runner);
        } finally {
            await runner.release();
        }
        const connection = await createConnection();
        await credentials.saveCredentials(connection.id, {
            accessToken: "access",
            refreshToken: "refresh",
        });
        const stored = await source
            .getRepository(UserConnectionCredential)
            .findOneByOrFail({ connectionId: connection.id });
        expect(stored.accessTokenEncrypted).not.toContain("access");
        expect(
            (await credentials.getCredentials(connection.id))?.accessToken,
        ).toBe("access");
        await source.getRepository(UserConnection).delete(connection.id);
        expect(await credentials.getCredentials(connection.id)).toBeNull();
    });

    it("changes and clears an existing collection without resetting sync or credentials", async () => {
        const connection = await createConnection();
        await source
            .getRepository(UserConnection)
            .update(connection.id, { autoImportCollectionId: "old" });
        await credentials.saveCredentials(connection.id, {
            accessToken: "access",
        });
        await state.initialize(
            connection.id,
            connection.sourceUserId,
            new Date(Date.now() + 86400000),
        );
        const before = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId: connection.id });
        const service = new ConnectionsService(
            source.getRepository(UserConnection),
            {} as any,
            {
                findOneById: async (id: string) => ({
                    id,
                    libraryUserId: connection.profileUserId,
                }),
            } as any,
            state,
            new ConnectionProviderRegistry(),
            {} as any,
            credentials,
        );
        for (const collection of ["new", null]) {
            await service.updateSettings(
                connection.profileUserId,
                connection.id,
                { autoImportCollectionId: collection },
            );
            expect(
                (
                    await source
                        .getRepository(UserConnection)
                        .findOneByOrFail({ id: connection.id })
                ).autoImportCollectionId,
            ).toBe(collection);
        }
        expect(
            await source
                .getRepository(PlayerConnectionSync)
                .findOneByOrFail({ connectionId: connection.id }),
        ).toEqual(before);
        expect(
            (await credentials.getCredentials(connection.id))?.accessToken,
        ).toBe("access");
    });

    it("consumes state once across independent service instances", async () => {
        const first = new ConnectionAuthStateService(queue);
        const second = new ConnectionAuthStateService(queue);
        const pending = await first.initState({
            userId: "owner",
            type: EConnectionType.STEAM,
        });
        const redis = await queue.client;
        expect(await redis.pttl(`conn-auth-state:${pending}`)).toBeGreaterThan(
            590000,
        );
        const results = await Promise.allSettled([
            first.consumeState(pending, "owner", EConnectionType.STEAM),
            second.consumeState(pending, "owner", EConnectionType.STEAM),
        ]);
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
    });

    it("uses atomic refresh locks with owner-checked renewal and release", async () => {
        const first = new XboxSyncAuthService(
            {} as any,
            {} as any,
            source.getRepository(UserConnection),
            credentials,
            queue,
        ) as any;
        const second = new XboxSyncAuthService(
            {} as any,
            {} as any,
            source.getRepository(UserConnection),
            credentials,
            queue,
        ) as any;
        const key = `xbox-token-refresh-lock:${randomUUID()}`;
        const results = await Promise.all([
            first.acquireLock(key, "first", 25),
            second.acquireLock(key, "second", 25),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        const redis = await queue.client;
        const owner = await redis.get(key);
        await redis.pexpire(key, 1000);
        expect(await first.renewLock(key, owner)).toBe(1);
        expect(await redis.pttl(key)).toBeGreaterThan(59000);
        await redis.set(key, "successor", "PX", 60000);
        expect(await first.renewLock(key, owner)).toBe(0);
        await first.releaseLock(key, owner);
        expect(await redis.get(key)).toBe("successor");
        await second.releaseLock(key, "successor");
        expect(await redis.get(key)).toBeNull();
    });

    it("reconnecting replaces failed sync state and invalidates old full and game leases", async () => {
        const connection = await createConnection();
        await state.initialize(
            connection.id,
            connection.sourceUserId,
            new Date(0),
        );
        await source.getRepository(PlayerConnectionSync).update(connection.id, {
            outcome: "reauth_required",
            ownerToken: randomUUID(),
            nextEligibleAt: new Date(Date.now() + 86400000),
            retryAt: new Date(Date.now() + 3600000),
            leaseExpiresAt: new Date(Date.now() + 90000),
        });
        await source.getRepository(PlayerGameSync).save({
            connectionId: connection.id,
            sourceUserId: connection.sourceUserId,
            externalGameId: 1,
            nextEligibleAt: new Date(),
            reconcileAt: new Date(),
            ownerToken: randomUUID(),
        });
        await source
            .getRepository(UserConnection)
            .update(connection.id, {
                authStatus: EConnectionAuthStatus.REAUTH_REQUIRED,
            });
        const registry = new ConnectionProviderRegistry();
        registry.registerAuthStrategy(EConnectionType.XBOX, {
            completeRedirectAuth: async () => ({
                sourceUserId: connection.sourceUserId,
                sourceUsername: "reconnected",
                credentials: { accessToken: "new-access" },
            }),
        });
        const authState = new ConnectionAuthStateService(queue);
        const pending = await authState.initState({
            userId: connection.profileUserId,
            type: EConnectionType.XBOX,
        });
        const service = new ConnectionsService(
            source.getRepository(UserConnection),
            { registerJob: jest.fn().mockResolvedValue(undefined) } as any,
            {} as any,
            state,
            registry,
            authState,
            credentials,
        );
        await service.completeRedirectAuth(
            connection.profileUserId,
            EConnectionType.XBOX,
            { state: pending, callbackParams: {} },
        );
        const current = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId: connection.id });
        expect(current).toMatchObject({
            outcome: "unknown",
            retryAt: null,
            ownerToken: null,
            leaseExpiresAt: null,
        });
        expect(
            await source
                .getRepository(PlayerGameSync)
                .countBy({ connectionId: connection.id }),
        ).toBe(0);
        expect((await state.due()).map((row) => row.connectionId)).toContain(
            connection.id,
        );
        expect(
            await state.claim(connection.id, connection.sourceUserId),
        ).not.toBeNull();
    });

    it("BullMQ stops a revoked grant after one attempt and releases sync ownership", async () => {
        const connection = await createConnection();
        await state.initialize(
            connection.id,
            connection.sourceUserId,
            new Date(0),
        );
        const owner = await state.claim(connection.id, connection.sourceUserId);
        const importer = { run: jest.fn() };
        const processor = new PlayerDataProcessor(
            state,
            {
                updatePlaytimeInfo: async () => {
                    throw new ProviderSyncError("reauth_required", "revoked");
                },
            } as any,
            importer as any,
        );
        const worker = new Worker(
            queue.name,
            (job) => processor.process(job as any),
            { connection: redisConnection },
        );
        try {
            await worker.waitUntilReady();
            const failed = new Promise<void>((resolve, reject) => {
                worker.once("failed", () => resolve());
                worker.once("error", reject);
            });
            const job = await queue.add(
                PLAYER_DATA_JOB,
                { userId: connection.profileUserId, source: "xbox", owner },
                { attempts: 5 },
            );
            await failed;
            const stored = await queue.getJob(job.id!);
            expect(await stored!.getState()).toBe("failed");
            expect(stored!.attemptsMade).toBe(1);
            expect(importer.run).not.toHaveBeenCalled();
            expect(
                await source
                    .getRepository(PlayerConnectionSync)
                    .findOneByOrFail({ connectionId: connection.id }),
            ).toMatchObject({
                outcome: "reauth_required",
                retryAt: null,
                ownerToken: null,
                leaseExpiresAt: null,
            });
        } finally {
            await worker.close();
        }
    });
});
