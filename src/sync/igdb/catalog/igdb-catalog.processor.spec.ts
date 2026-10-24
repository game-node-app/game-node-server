import { Job, Queue } from "bullmq";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { IgdbSyncModule } from "../igdb-sync.module";
import { IgdbCatalogProcessor } from "./igdb-catalog.processor";
import { IgdbCatalogRunnerService } from "./igdb-catalog-runner.service";
import {
    CATALOG_JOB_OPTIONS,
    IGDB_CATALOG_JOB_NAME,
    IGDB_CATALOG_QUEUE_NAME,
    catalogJobId,
} from "./igdb-catalog.constants";

describe("catalog worker registration", () => {
    it("registers the dedicated queue and providers with bounded retention", () => {
        const providers = Reflect.getMetadata(
            MODULE_METADATA.PROVIDERS,
            IgdbSyncModule,
        );
        expect(providers).toContain(IgdbCatalogProcessor);
        expect(providers).toContain(IgdbCatalogRunnerService);
        const imports = Reflect.getMetadata(
            MODULE_METADATA.IMPORTS,
            IgdbSyncModule,
        );
        const options = imports
            .flatMap((item: any) => item.providers ?? [])
            .find(
                (provider: any) =>
                    provider.provide ===
                    `BullMQQueueOptions_${IGDB_CATALOG_QUEUE_NAME}`,
            )
            ?.useFactory({ getDependencyRef: () => ({}) });
        expect(options.defaultJobOptions).toEqual(CATALOG_JOB_OPTIONS);
        expect(CATALOG_JOB_OPTIONS).toMatchObject({
            attempts: 1,
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 10 },
        });
    });
    it("enforces global concurrency one and accepts only the compact run job", async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const setGlobalConcurrency = jest.fn().mockResolvedValue(undefined);
        const processor = new IgdbCatalogProcessor(
            { run } as unknown as IgdbCatalogRunnerService,
            { setGlobalConcurrency } as unknown as Queue,
        );
        await processor.onModuleInit();
        expect(setGlobalConcurrency).toHaveBeenCalledWith(1);
        const job = {
            name: IGDB_CATALOG_JOB_NAME,
            id: catalogJobId("fixture"),
            data: { runId: "fixture" },
        } as Job<{ runId: string }>;
        await processor.process(job);
        expect(run).toHaveBeenCalledWith("fixture");
        await processor.process({
            ...job,
            data: { runId: "fixture", game: { id: 1 } },
        } as any);
        await processor.process({ ...job, id: "stale" } as any);
        expect(run).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(job.data)).toBe('{"runId":"fixture"}');
    });
});
