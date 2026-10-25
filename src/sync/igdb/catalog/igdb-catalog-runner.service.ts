import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { normalizeIgdbGame } from "../utils/game-conversor-utils";
import { InvalidGameEntryError } from "../../../game/game-repository/create/game-import-context";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import {
    CATALOG_CONFIG,
    CatalogDataError,
    IgdbCatalogClient,
} from "./igdb-catalog.client";
import { CATALOG_TIMING, IgdbCatalogConfig } from "./igdb-catalog.config";
import { IgdbCatalogImportService } from "./igdb-catalog-import.service";
import {
    CatalogOwner,
    CatalogOwnershipLost,
    IgdbCatalogStateService,
} from "./igdb-catalog-state.service";
import { CatalogStage } from "./entities/igdb-catalog-state.entity";
import {
    runCatalogStage,
    isTransientCatalogError,
    catalogRetryDelay,
    retryRuntime,
} from "./igdb-catalog.retry";

@Injectable()
export class IgdbCatalogRunnerService implements OnModuleDestroy {
    private readonly logger = new Logger(IgdbCatalogRunnerService.name);
    private stopping = false;
    private active?: Promise<void>;
    private controller?: AbortController;
    constructor(
        private readonly state: IgdbCatalogStateService,
        private readonly client: IgdbCatalogClient,
        private readonly importer: IgdbCatalogImportService,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
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
            let upper = claimed.upperId;
            if (upper === null) {
                upper = await attempt("upper", null, async () => {
                    const persisted = await this.state.readStatus();
                    if (persisted.upperId !== null) return persisted.upperId;
                    const value = await this.client.fetchUpperId(
                        controller.signal,
                    );
                    ensureActive();
                    await this.state.setUpperId(owner, value);
                    return value;
                });
            }
            let cursor = claimed.committedId;
            let batches = claimed.committedBatches;
            let games = claimed.committedGames;
            this.logger.log({
                event: "catalog.run",
                runId,
                cursor,
                committedBatches: batches,
                committedGames: games,
            });
            while (true) {
                ensureActive();
                let page = await attempt("fetch", null, () =>
                    this.client.fetchPage(
                        cursor,
                        upper!,
                        this.config.batchSize,
                        controller.signal,
                    ),
                );
                if (page.length === 0) {
                    await attempt(
                        "complete",
                        null,
                        async () => {
                            ensureActive();
                            await this.state.completeRun(
                                owner,
                                this.config.intervalDays,
                            );
                        },
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
                const batchStart = Date.now();
                let failedStageGame: number | null = null;
                while (true) {
                    let index = 0;
                    let failed = false;
                    let failure: unknown;
                    const consume = async () => {
                        while (!failed && index < page.length) {
                            ensureActive();
                            const entry = page[index++];
                            try {
                                const used = await this.state.readStageAttempts(
                                    owner,
                                    "game",
                                    entry.id,
                                );
                                if (used >= this.config.maxAttempts)
                                    throw new CatalogDataError(
                                        "Game stage attempt budget exhausted; run will resume after cooldown",
                                    );
                                await this.state.admitStageAttempt(
                                    owner,
                                    "game",
                                    entry.id,
                                    this.config.maxAttempts,
                                );
                                ensureActive();
                                try {
                                    await this.importer.persist(
                                        normalizeIgdbGame(entry),
                                        owner,
                                        limiter,
                                        claimed.forceReconciliation,
                                    );
                                } catch (error) {
                                    // Source data cannot be fixed locally; skip it so the scan never stalls.
                                    if (
                                        !(
                                            error instanceof
                                            InvalidGameEntryError
                                        )
                                    )
                                        throw error;
                                    this.logger.warn({
                                        event: "catalog.game.skipped",
                                        runId,
                                        gameId: entry.id,
                                        reason: error.message,
                                    });
                                }
                                await this.state.finishAttemptStage(
                                    owner,
                                    "game",
                                    entry.id,
                                );
                            } catch (error) {
                                if (!failed) {
                                    failed = true;
                                    failure = error;
                                    failedStageGame = entry.id;
                                }
                                throw error;
                            }
                        }
                    };
                    const settled = await Promise.allSettled(
                        Array.from(
                            { length: this.config.gameConcurrency },
                            consume,
                        ),
                    );
                    const rejected = settled.find(
                        (result): result is PromiseRejectedResult =>
                            result.status === "rejected",
                    );
                    if (!rejected) break;
                    ensureActive();
                    stage = "game";
                    gameId = failedStageGame;
                    const used = await this.state.readStageAttempts(
                        owner,
                        "game",
                        failedStageGame,
                    );
                    if (
                        !isTransientCatalogError(failure) ||
                        used >= this.config.maxAttempts
                    )
                        throw failure;
                    await retryRuntime.sleep(
                        catalogRetryDelay(used, failure, retryRuntime),
                        controller.signal,
                    );
                }
                ensureActive();
                const maximum = page[page.length - 1].id;
                const size = page.length;
                await attempt(
                    "checkpoint",
                    null,
                    async () => {
                        ensureActive();
                        await this.state.commitBatch(
                            owner,
                            cursor,
                            maximum,
                            size,
                        );
                    },
                    false,
                );
                cursor = maximum;
                batches++;
                games += size;
                page = [];
                const memory = process.memoryUsage();
                this.logger.log({
                    event: "catalog.batch",
                    runId,
                    cursor,
                    committedBatches: batches,
                    committedGames: games,
                    durationMs: Date.now() - batchStart,
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
