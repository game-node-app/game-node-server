import { connectionToPlaytimeImportSource } from "../../playtime/playtime.util";
import { OnWorkerEvent, Processor } from "@nestjs/bullmq";
import { Job, UnrecoverableError } from "bullmq";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { PlaytimeWatchProcessor } from "../../playtime/watch/playtime-watch.processor";
import { PLAYTIME_WATCH_QUEUE_JOB_NAME } from "../../playtime/watch/playtime-watch.constants";
import { ImporterWatchProcessor } from "../../importer/importer-watch/importer-watch.processor";
import { connectionToImporterSource } from "../../importer/importer.util";
import {
    PlayerSyncAttempt,
    recordPlayerSyncStats,
} from "../player-sync-attempt";
import { providerFailure } from "../provider-sync.error";
import {
    PLAYER_DATA_JOB,
    PLAYER_DATA_QUEUE,
    PlayerDataJob,
} from "./player-data.constants";
import {
    PlayerSyncOwnershipLost,
    PlayerSyncStateService,
} from "./player-sync-state.service";

@Processor(PLAYER_DATA_QUEUE, { concurrency: 1 })
export class PlayerDataProcessor extends WorkerHostProcessor {
    constructor(
        private readonly state: PlayerSyncStateService,
        private readonly playtime: PlaytimeWatchProcessor,
        private readonly importer: ImporterWatchProcessor,
    ) {
        super();
    }

    @PlayerSyncAttempt()
    async process(job: Job<PlayerDataJob>) {
        if (
            job.name !== PLAYER_DATA_JOB ||
            !job.data.owner ||
            job.data.owner.externalGameId != null ||
            job.data.owner.userId !== job.data.userId ||
            connectionToPlaytimeImportSource(job.data.owner.source) !==
                job.data.source
        )
            throw new UnrecoverableError("Invalid player refresh payload");
        const owner = job.data.owner;
        try {
            return await this.state.runOwned(owner, async () => {
                const stages = await this.state.dueStages(owner);
                let failure: ReturnType<typeof providerFailure> | undefined;
                for (const stage of stages) {
                    try {
                        let empty = false;
                        if (stage === "playtime") {
                            const result =
                                await this.playtime.updatePlaytimeInfo(
                                    owner.source,
                                    job,
                                );
                            empty = result?.outcome === "empty";
                        } else {
                            empty =
                                (await this.importer.run({
                                    userId: owner.userId,
                                    source: connectionToImporterSource(
                                        owner.source,
                                    ),
                                    owner,
                                })) === "empty";
                        }
                        await this.state.completeStage(
                            owner,
                            stage,
                            empty ? "empty" : "complete",
                        );
                        recordPlayerSyncStats({ stagesSucceeded: 1 });
                    } catch (error) {
                        if (error instanceof PlayerSyncOwnershipLost)
                            throw error;
                        recordPlayerSyncStats({ stagesFailed: 1 });
                        const current = providerFailure("Player", error);
                        await this.state.failStage(owner, stage, current);
                        if (current.outcome === "reauth_required") {
                            await this.state.finish(owner, current);
                            throw current;
                        }
                        failure ??= current;
                    }
                }
                if (failure) {
                    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
                        await this.state.finish(owner, failure);
                    throw failure;
                }
                await this.state.finish(owner);
                return { outcome: "complete", stages };
            });
        } catch (error) {
            if (error instanceof PlayerSyncOwnershipLost)
                return { outcome: "stale-skip" };
            throw error;
        }
    }

    @OnWorkerEvent("progress")
    async onProgress(job: Job<PlayerDataJob>) {
        return this.playtime.onProgress(
            Object.assign(Object.create(job), {
                name: PLAYTIME_WATCH_QUEUE_JOB_NAME,
            }),
        );
    }
}
