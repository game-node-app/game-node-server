import { ConfigService } from "@nestjs/config";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Cron } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { EConnectionType } from "../../connection/connections.constants";
import { connectionToPlaytimeImportSource } from "../../playtime/playtime.util";
import {
    PLAYER_DATA_JOB,
    PLAYER_DATA_QUEUE,
    PlayerDataJob,
} from "./player-data.constants";
import {
    PlayerSyncOwnershipLost,
    PlayerSyncStateService,
} from "./player-sync-state.service";

@Injectable()
export class PlayerDataQueueService implements OnModuleInit {
    private readonly logger = new Logger(PlayerDataQueueService.name);
    constructor(
        @InjectQueue(PLAYER_DATA_QUEUE)
        private readonly queue: Queue<PlayerDataJob>,
        private readonly state: PlayerSyncStateService,
        private readonly config: ConfigService,
    ) {}
    async onModuleInit() {
        await this.state.bootstrapExisting();
    }

    async request(userId: string, source: EConnectionType) {
        const connection = await this.state.findConnection(userId, source);
        if (!connection) return { status: "disconnected" as const, source };
        await this.state.initializeExisting(
            connection.id,
            connection.sourceUserId,
        );
        const owner = await this.state.claim(
            connection.id,
            connection.sourceUserId,
        );
        if (!owner) return this.state.status(userId, source);
        await this.state.enqueue(owner, this.queue, PLAYER_DATA_JOB, {
            userId,
            source: connectionToPlaytimeImportSource(source),
        });
        return {
            ...(await this.state.status(userId, source)),
            status: "accepted" as const,
        };
    }

    @Cron("*/5 * * * *")
    async registerDueJobs() {
        if (this.config.get<string>("PLAYER_DATA_SYNC_ENABLED") === "false")
            return { admitted: 0, failed: 0 };
        let cursor: { at: Date; id: number } | undefined;
        let admitted = 0;
        let failed = 0;
        while (true) {
            const page = await this.state.due(cursor);
            if (!page.length) break;
            for (const row of page) {
                try {
                    const owner = await this.state.claim(
                        row.connectionId,
                        row.sourceUserId,
                    );
                    if (owner) {
                        await this.state.enqueue(
                            owner,
                            this.queue,
                            PLAYER_DATA_JOB,
                            {
                                userId: owner.userId,
                                source: connectionToPlaytimeImportSource(
                                    owner.source,
                                ),
                            },
                        );
                        admitted++;
                    }
                } catch (error) {
                    if (!(error instanceof PlayerSyncOwnershipLost)) failed++;
                }
            }
            const last = page[page.length - 1];
            cursor = { at: last.nextEligibleAt, id: last.connectionId };
        }
        this.logger.log({ event: "player-sync-admission", admitted, failed });
        if (failed)
            throw new Error(
                `${failed} player synchronization queue admissions failed`,
            );
        return { admitted, failed };
    }
}
