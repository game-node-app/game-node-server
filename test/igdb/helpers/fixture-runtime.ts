import "reflect-metadata";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Queue } from "bullmq";
import { importEntities } from "./import-entities";
import { testEnvironment } from "./test-environment";
import { fixtureResponse, CatalogFixture } from "./generated-catalog";
import { ResourceBounds } from "./resource-bounds";
import { IgdbCatalogState } from "../../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { IgdbCatalogStateService } from "../../../src/sync/igdb/catalog/igdb-catalog-state.service";
import { IgdbCatalogRunnerService } from "../../../src/sync/igdb/catalog/igdb-catalog-runner.service";
import { IgdbCatalogImportService } from "../../../src/sync/igdb/catalog/igdb-catalog-import.service";
import { IgdbCatalogClient } from "../../../src/sync/igdb/catalog/igdb-catalog.client";
import { IgdbOutboundBudgetService } from "../../../src/sync/igdb/catalog/igdb-outbound-budget.service";
import { IgdbAuthService } from "../../../src/sync/igdb/auth/igdb-auth.service";
import { catalogConfig } from "../../../src/sync/igdb/catalog/igdb-catalog.config";
import {
    IGDB_CATALOG_QUEUE_NAME,
    IGDB_OUTBOUND_BUDGET_QUEUE_NAME,
} from "../../../src/sync/igdb/catalog/igdb-catalog.constants";
import { GameRepositoryCreateService } from "../../../src/game/game-repository/create/game-repository-create.service";

export async function fixtureRuntime(
    fixture: CatalogFixture,
    options: {
        prefix?: string;
        reset?: boolean;
        sourceUrl?: string;
        beforeCheckpoint?: () => Promise<void>;
        afterGame?: (id: number) => Promise<void>;
        onBatch?: (count: number) => Promise<void>;
        trackPages?: boolean;
        verifyRedis?: boolean;
        tablePrefix?: string;
    } = {},
) {
    Logger.overrideLogger(false);
    const settings = testEnvironment({
        ...process.env,
        IGDB_TEST_QUEUE_PREFIX:
            options.prefix ?? `igdb-test-resource-${randomUUID()}`,
    });
    const tablePrefix =
        options.tablePrefix ?? process.env.IGDB_TEST_TABLE_PREFIX ?? "";
    if (tablePrefix && !/^r_[a-f0-9]{8}_$/.test(tablePrefix))
        throw new Error("Invalid isolated fixture table prefix");
    const source = await new DataSource({
        ...settings.mysql,
        timezone: "Z",
        entityPrefix: tablePrefix,
        entities: [...importEntities(), IgdbCatalogState],
        synchronize: options.reset ?? true,
    }).initialize();
    if (options.reset ?? true) {
        const reset = source.createQueryRunner();
        try {
            await reset.connect();
            await reset.query("SET FOREIGN_KEY_CHECKS = 0");
            for (const metadata of source.entityMetadatas)
                await reset.query(`TRUNCATE TABLE \`${metadata.tableName}\``);
        } finally {
            await reset.query("SET FOREIGN_KEY_CHECKS = 1");
            await reset.release();
        }
        await source
            .getRepository(IgdbCatalogState)
            .insert(new IgdbCatalogState());
    }
    const bounds = new ResourceBounds();
    let invalidGame: number | null = null;
    const server = createServer(async (request, response) => {
        try {
            let query = "";
            for await (const chunk of request) {
                query += chunk.toString();
                if (query.length > 32768)
                    throw new Error("Fixture query too large");
            }
            const result = fixtureResponse(query, fixture);
            if (invalidGame !== null && query.includes("sort id asc")) {
                for (const entry of result)
                    if (entry.id === invalidGame) (entry as any).name = "";
            }
            if (
                options.trackPages !== false &&
                query.includes("sort id asc") &&
                result.length
            )
                bounds.pageOpened();
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify(result));
        } catch {
            response.statusCode = 500;
            response.end(
                '{"error":"Invalid local fixture query or page bounds"}',
            );
        }
    });
    let endpoint = options.sourceUrl;
    if (endpoint) {
        if (
            !["127.0.0.1", "localhost", "[::1]"].includes(
                new URL(endpoint).hostname,
            )
        )
            throw new Error("Fixture source must be loopback");
    } else {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/games`;
    }
    const http = axios.create({ proxy: false });
    http.interceptors.request.use((request) => {
        request.url = endpoint;
        return request;
    });
    const config = catalogConfig({});
    const state = new IgdbCatalogStateService(source);
    const budgetQueue = new Queue(IGDB_OUTBOUND_BUDGET_QUEUE_NAME, {
        connection: settings.redis,
        prefix: settings.prefix,
    });
    const queue = new Queue(IGDB_CATALOG_QUEUE_NAME, {
        connection: settings.redis,
        prefix: settings.prefix,
    });
    const games = new GameRepositoryCreateService({
        get: (_key: string, fallback: unknown) => fallback,
    } as ConfigService);
    const importer = new IgdbCatalogImportService(games, state);
    const persist = importer.persist.bind(importer);
    const instrumented = new WeakSet<object>();
    importer.persist = async (game, owner, limiter, force) => {
        if (!instrumented.has(limiter)) {
            instrumented.add(limiter);
            const run = limiter.run.bind(limiter);
            limiter.run = (operation) =>
                run(async () => {
                    bounds.relationStarted(config.relationConcurrency);
                    try {
                        return await operation();
                    } finally {
                        bounds.activeRelations--;
                    }
                });
        }
        bounds.gameStarted(config.gameConcurrency);
        try {
            await persist(game, owner, limiter, force);
            await options.afterGame?.(game.id);
        } finally {
            bounds.activeGames--;
        }
    };
    let batches = 0;
    const commit = state.commitBatch.bind(state);
    state.commitBatch = async (...args) => {
        await options.beforeCheckpoint?.();
        await commit(...args);
        if (!options.sourceUrl && options.trackPages !== false)
            bounds.pageCommitted();
        batches++;
        await options.onBatch?.(batches);
    };
    const client = new IgdbCatalogClient(
        new HttpService(http),
        {
            getAuthHeaders: async () => ({
                Authorization: "Bearer fixture-only",
                "Client-ID": "fixture-only",
            }),
        } as unknown as IgdbAuthService,
        config,
        {
            run: async <T>(work: () => Promise<T>) => {
                if (options.verifyRedis) {
                    try {
                        await (await budgetQueue.client).ping();
                    } catch {
                        throw Object.assign(
                            new Error("Local fixture Redis connection lost"),
                            { code: "ECONNRESET" },
                        );
                    }
                }
                return work();
            },
        } as IgdbOutboundBudgetService,
    );
    const runner = new IgdbCatalogRunnerService(
        state,
        client,
        importer,
        config,
    );
    const close = async () => {
        await runner.onModuleDestroy();
        await Promise.all([budgetQueue.close(), queue.close()]);
        if (server.listening)
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        if (options.tablePrefix && (options.reset ?? true)) {
            const cleanup = source.createQueryRunner();
            try {
                await cleanup.connect();
                await cleanup.query("SET FOREIGN_KEY_CHECKS = 0");
                for (const metadata of source.entityMetadatas) {
                    if (!metadata.tableName.startsWith(options.tablePrefix))
                        throw new Error(
                            "Refusing to clean an unrelated fixture table",
                        );
                    await cleanup.query(
                        `DROP TABLE IF EXISTS \`${metadata.tableName}\``,
                    );
                }
            } finally {
                await cleanup.query("SET FOREIGN_KEY_CHECKS = 1");
                await cleanup.release();
            }
        }
        await source.destroy();
    };
    return {
        source,
        endpoint,
        setInvalidGame: (id: number | null) => {
            invalidGame = id;
        },
        state,
        runner,
        queue,
        budgetQueue,
        bounds,
        config,
        settings,
        close,
    };
}
