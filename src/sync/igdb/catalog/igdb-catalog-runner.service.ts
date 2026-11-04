import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import {
    CATALOG_CONFIG,
    CatalogDataError,
    IgdbCatalogClient,
} from "./igdb-catalog.client";
import { CATALOG_TIMING, IgdbCatalogConfig } from "./igdb-catalog.config";
import {
    CatalogOwner,
    CatalogOwnershipLost,
    IgdbCatalogStateService,
} from "./igdb-catalog-state.service";
import { CatalogStage } from "./entities/igdb-catalog-state.entity";
import { runCatalogStage } from "./igdb-catalog.retry";

import { IGDB_SYNC_ENDPOINTS } from "./igdb-sync-endpoints";
import { IgdbRefreshService } from "./igdb-refresh.service";

@Injectable()
export class IgdbCatalogRunnerService implements OnModuleDestroy {
    private readonly logger = new Logger(IgdbCatalogRunnerService.name);
    private stopping = false;
    private active?: Promise<void>;
    private controller?: AbortController;
    constructor(
        private readonly state: IgdbCatalogStateService,
        private readonly client: IgdbCatalogClient,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
        private readonly refresh: IgdbRefreshService,
    ) {}

    run(runId: string): Promise<void> {
        if (this.stopping || this.active) return Promise.resolve();
        this.active = this.execute(runId).finally(() => {
            this.active = undefined;
        });
        return this.active;
    }

    async onModuleDestroy() {
        this.stopping = true;
        this.controller?.abort(new Error("Catalog worker shutting down"));
        await this.active;
    }

    private async execute(runId: string) {
        const claimed = await this.state.claimRun(runId);
        if (!claimed) return;
        const owner = claimed as CatalogOwner;
        const controller = new AbortController();
        this.controller = controller;
        const limiter = new AsyncLeafLimiter(this.config.relationConcurrency);
        let ownershipLost = false;
        let terminal = false;
        let renewal: Promise<void> | undefined;
        const heartbeat = setInterval(() => {
            if (renewal) return;
            renewal = this.state
                .renewLease(owner)
                .catch(() => {
                    ownershipLost = true;
                    controller.abort(new CatalogOwnershipLost());
                })
                .finally(() => {
                    renewal = undefined;
                });
        }, CATALOG_TIMING.heartbeatMs);
        let stage: CatalogStage = "upper";
        let gameId: number | null = null;
        const ensureActive = () => controller.signal.throwIfAborted();
        const attempt = async <T>(
            nextStage: CatalogStage,
            nextGame: number | null,
            work: () => Promise<T>,
            complete = true,
        ): Promise<T> => {
            ensureActive();
            stage = nextStage;
            gameId = nextGame;
            try {
                return await runCatalogStage(
                    work,
                    {
                        read: () =>
                            this.state.readStageAttempts(
                                owner,
                                nextStage,
                                nextGame,
                            ),
                        increment: () =>
                            this.state.admitStageAttempt(
                                owner,
                                nextStage,
                                nextGame,
                                this.config.maxAttempts,
                            ),
                        success: () =>
                            complete
                                ? this.state.finishAttemptStage(
                                      owner,
                                      nextStage,
                                      nextGame,
                                  )
                                : Promise.resolve(),
                    },
                    undefined,
                    this.config.maxAttempts,
                    controller.signal,
                );
            } catch (error) {
                stage = nextStage;
                gameId = nextGame;
                throw error;
            }
        };
        const started = Date.now();
        try {
            let endpointIndex = IGDB_SYNC_ENDPOINTS.findIndex(
                (entry) => entry.endpoint === claimed.sweepEndpoint,
            );
            if (endpointIndex < 0)
                throw new CatalogDataError("Unknown sweep endpoint");
            let cursor = claimed.committedId;
            let upper = claimed.upperId;
            let batches = claimed.committedBatches;
            let games = claimed.committedGames;
            while (endpointIndex < IGDB_SYNC_ENDPOINTS.length) {
                ensureActive();
                const endpoint = IGDB_SYNC_ENDPOINTS[endpointIndex];
                if (upper === null) {
                    upper = await attempt("upper", null, async () => {
                        const persisted = await this.state.readStatus();
                        if (persisted.upperId !== null)
                            return persisted.upperId;
                        const value = await this.client.fetchUpperId(
                            controller.signal,
                            endpoint.endpoint,
                        );
                        ensureActive();
                        await this.state.setUpperId(owner, value);
                        return value;
                    });
                }
                const page = await attempt("fetch", null, () =>
                    this.client.fetchSweepPage(
                        endpoint,
                        cursor,
                        upper!,
                        controller.signal,
                    ),
                );
                if (!page.length) {
                    if (endpointIndex === IGDB_SYNC_ENDPOINTS.length - 1) {
                        await attempt(
                            "complete",
                            null,
                            () =>
                                this.state.completeRun(
                                    owner,
                                    this.config.intervalDays,
                                ),
                            false,
                        );
                        terminal = true;
                        this.logger.log({
                            event: "catalog.completed",
                            runId,
                            cursor,
                            committedBatches: batches,
                            committedGames: games,
                            durationMs: Date.now() - started,
                        });
                        return;
                    }
                    await attempt(
                        "checkpoint",
                        null,
                        () =>
                            this.state.nextEndpoint(
                                owner,
                                endpoint.endpoint,
                                IGDB_SYNC_ENDPOINTS[endpointIndex + 1].endpoint,
                            ),
                        false,
                    );
                    endpointIndex++;
                    cursor = 0;
                    upper = null;
                    continue;
                }
                const changed = await this.refresh.mismatches(endpoint, page);
                for (const row of changed) {
                    ensureActive();
                    await attempt("game", row.id, () =>
                        this.refresh.apply(
                            endpoint,
                            [row],
                            (manager) =>
                                this.state.assertOwnership(manager, owner),
                            limiter,
                            claimed.forceReconciliation,
                            false,
                            controller.signal,
                        ),
                    );
                }
                const maximum = page[page.length - 1].id;
                await attempt(
                    "checkpoint",
                    null,
                    () =>
                        this.state.commitBatch(
                            owner,
                            cursor,
                            maximum,
                            page.length,
                        ),
                    false,
                );
                cursor = maximum;
                batches++;
                games += page.length;
                const memory = process.memoryUsage();
                this.logger.log({
                    event: "catalog.batch",
                    runId,
                    endpoint: endpoint.endpoint,
                    cursor,
                    committedBatches: batches,
                    committedGames: games,
                    durationMs: Date.now() - started,
                    rss: memory.rss,
                    heapUsed: memory.heapUsed,
                });
            }
        } catch (error) {
            if (
                !ownershipLost &&
                !this.stopping &&
                !(error instanceof CatalogOwnershipLost)
            ) {
                const summary =
                    error instanceof CatalogDataError
                        ? error.message
                        : `Catalog ${stage} failed; retrying automatically after cooldown`;
                await this.state.recordFailure(owner, stage, gameId, summary);
                const failedStatus = await this.state.readStatus();
                await this.state.pauseRun(owner, summary);
                terminal = true;
                this.logger.error({
                    event: "catalog.paused",
                    runId,
                    cursor: failedStatus.committedId,
                    committedGames: failedStatus.committedGames,
                    committedBatches: failedStatus.committedBatches,
                    attempt: failedStatus.attempt,
                    stage,
                    gameId,
                    error:
                        error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - started,
                });
            }
            if (!this.stopping && !ownershipLost) throw error;
        } finally {
            clearInterval(heartbeat);
            await renewal;
            if (!terminal && !ownershipLost)
                await this.state.releaseOwnership(owner).catch(() => undefined);
            this.controller = undefined;
        }
    }
}
