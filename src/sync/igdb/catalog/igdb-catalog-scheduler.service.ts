import {
    Inject,
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
    IgdbCatalogStateService,
    CatalogOwner,
} from "./igdb-catalog-state.service";
import { CATALOG_CONFIG } from "./igdb-catalog.client";
import { IgdbCatalogConfig } from "./igdb-catalog.config";
import {
    IGDB_CATALOG_QUEUE_NAME,
    IGDB_CATALOG_JOB_NAME,
    CATALOG_JOB_OPTIONS,
    catalogJobId,
} from "./igdb-catalog.constants";

@Injectable()
export class IgdbCatalogSchedulerService
    implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(IgdbCatalogSchedulerService.name);
    private active?: Promise<void>;
    private stopping = false;
    constructor(
        private readonly state: IgdbCatalogStateService,
        @InjectQueue(IGDB_CATALOG_QUEUE_NAME) private readonly queue: Queue,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
    ) {}
    async onModuleInit() {
        await this.tick();
    }
    async onModuleDestroy() {
        this.stopping = true;
        await this.active;
    }
    @Interval(60000)
    async tick() {
        try {
            await this.reconcile();
        } catch (error) {
            this.logger.error({
                event: "catalog.scheduler.failed",
                message:
                    "Catalog reconciliation failed; check local database/queue connectivity",
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    reconcile(): Promise<void> {
        if (this.stopping) return Promise.resolve();
        if (this.active) return this.active;
        this.active = this.schedule().finally(() => {
            this.active = undefined;
        });
        return this.active;
    }
    private async schedule() {
        let status = await this.state.readStatus();
        if (status.status === "paused") {
            const resumed = await this.state.resumeRun(true);
            if (!resumed) return;
            this.logger.log({
                event: "catalog.resumed",
                runId: resumed.runId,
                cursor: resumed.committedId,
            });
            status = resumed;
        }
        if (status.status === "running" && status.runId) {
            const existing = await this.queue.getJob(
                catalogJobId(status.runId),
            );
            if (
                existing &&
                ["waiting", "active", "delayed", "waiting-children"].includes(
                    await existing.getState(),
                )
            )
                return;
        }
        const claimed = await this.state.claimRun();
        if (!claimed) return;
        await this.state.releaseOwnership(claimed as CatalogOwner);
        if (this.stopping) return;
        const id = catalogJobId(claimed.runId!);
        const existing = await this.queue.getJob(id);
        if (existing) {
            const state = await existing.getState();
            if (state === "failed" || state === "completed")
                await existing.retry(state);
            return;
        }
        await this.queue.add(
            IGDB_CATALOG_JOB_NAME,
            { runId: claimed.runId },
            { ...CATALOG_JOB_OPTIONS, jobId: id },
        );
    }
}
