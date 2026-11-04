import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import { CATALOG_CONFIG, IgdbCatalogClient } from "./igdb-catalog.client";
import { CATALOG_TIMING, IgdbCatalogConfig } from "./igdb-catalog.config";
import { CatalogOwnershipLost } from "./igdb-catalog-state.service";
import { IgdbDeltaStateService, DeltaOwner } from "./igdb-delta-state.service";
import { IgdbRefreshService } from "./igdb-refresh.service";
import { IGDB_SYNC_ENDPOINTS } from "./igdb-sync-endpoints";
import { runCatalogStage } from "./igdb-catalog.retry";

@Injectable()
export class IgdbDeltaService implements OnModuleDestroy {
    private readonly logger = new Logger(IgdbDeltaService.name);
    private active?: Promise<void>;
    private stopping = false;
    private controller?: AbortController;
    constructor(
        private readonly source: DataSource,
        private readonly state: IgdbDeltaStateService,
        private readonly client: IgdbCatalogClient,
        private readonly refresh: IgdbRefreshService,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
    ) {}
    run() {
        if (this.stopping || this.active)
            return this.active ?? Promise.resolve();
        this.active = this.execute().finally(() => {
            this.active = undefined;
        });
        return this.active;
    }
    async onModuleDestroy() {
        this.stopping = true;
        this.controller?.abort();
        await this.active;
    }
    private async execute() {
        const claimed = await this.state.claim();
        if (!claimed) return;
        const owner = claimed as DeltaOwner;
        const controller = new AbortController();
        this.controller = controller;
        const guard = (manager: any) =>
            this.state.assertOwnership(manager, owner);
        const limiter = new AsyncLeafLimiter(this.config.relationConcurrency);
        let renewal: Promise<void> | undefined;
        const heartbeat = setInterval(() => {
            if (!renewal)
                renewal = this.state
                    .renew(owner)
                    .catch(() => {
                        controller.abort(new CatalogOwnershipLost());
                    })
                    .finally(() => {
                        renewal = undefined;
                    });
        }, CATALOG_TIMING.heartbeatMs);
        const start = Date.now();
        let total = 0;
        try {
            for (const entry of IGDB_SYNC_ENDPOINTS.filter(
                (entry) => entry.delta,
            )) {
                controller.signal.throwIfAborted();
                const window = await this.state.window(
                    owner,
                    entry.endpoint,
                    this.config.intervalDays,
                );
                if (!window) continue;
                const started = Date.now();
                let cursor = window.cursor,
                    count = 0,
                    stage = "fetch";
                let failure: string | null = null;
                const attempt = async <T>(work: () => Promise<T>) => {
                    let used = 0;
                    return runCatalogStage(
                        work,
                        {
                            read: async () => used,
                            increment: async () => ++used,
                            success: async () => undefined,
                        },
                        undefined,
                        this.config.maxAttempts,
                        controller.signal,
                    );
                };
                try {
                    while (true) {
                        controller.signal.throwIfAborted();
                        await this.source.transaction(guard);
                        stage = "fetch";
                        const page = await attempt(() =>
                            this.client.fetchDeltaPage(
                                entry,
                                window.windowStart!,
                                window.windowEnd!,
                                cursor,
                                controller.signal,
                            ),
                        );
                        if (!page.length) {
                            stage = "complete";
                            await attempt(() =>
                                this.state.checkpoint(
                                    owner,
                                    entry.endpoint,
                                    cursor,
                                    null,
                                ),
                            );
                            window.watermark = window.windowEnd;
                            break;
                        }
                        stage = `apply:${page[0].id}`;
                        await attempt(() =>
                            this.refresh.apply(
                                entry,
                                page,
                                guard,
                                limiter,
                                false,
                                true,
                                controller.signal,
                            ),
                        );
                        stage = "checkpoint";
                        const next = page[page.length - 1].id;
                        await attempt(() =>
                            this.state.checkpoint(
                                owner,
                                entry.endpoint,
                                cursor,
                                next,
                            ),
                        );
                        cursor = next;
                        count += page.length;
                    }
                } catch (error) {
                    failure = stage;
                    if (
                        error instanceof CatalogOwnershipLost ||
                        controller.signal.aborted
                    ) {
                        controller.abort(error);
                        throw error;
                    }
                    await this.state.pause(
                        owner,
                        entry.endpoint,
                        `${stage}: required stage failed`,
                    );
                } finally {
                    total += count;
                    this.logger.log({
                        event: "catalog.delta.stream",
                        stream: entry.endpoint,
                        watermark: window.watermark,
                        watermarkLagMs: Date.now() - +window.watermark!,
                        windowStart: window.windowStart,
                        windowEnd: window.windowEnd,
                        cursor,
                        entriesApplied: count,
                        durationMs: Date.now() - started,
                        failureStage: failure,
                    });
                }
            }
        } finally {
            clearInterval(heartbeat);
            await renewal;
            if (!controller.signal.aborted) await this.state.release(owner);
            this.controller = undefined;
            this.logger.log({
                event: "catalog.delta.pass",
                entriesApplied: total,
                durationMs: Date.now() - start,
            });
        }
    }
}
