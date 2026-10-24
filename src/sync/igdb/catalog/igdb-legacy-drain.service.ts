import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { IGDB_SYNC_QUEUE_NAME } from "../igdb-sync.constants";

@Injectable()
export class IgdbLegacyDrainService {
    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME) private readonly queue: Queue,
    ) {}
    private async failureFingerprint(): Promise<string> {
        const hash = createHash("sha256");
        const redis = await this.queue.client;
        for (let offset = 0; ; offset += 100) {
            const rows = await redis.zrange(
                this.queue.toKey("failed"),
                offset,
                offset + 99,
                "WITHSCORES",
            );
            for (const value of rows) hash.update(`${value.length}:${value}`);
            if (rows.length < 200) break;
        }
        return hash.digest("hex");
    }
    async isDrained(): Promise<boolean> {
        const counts = await this.queue.getJobCounts(
            "waiting",
            "active",
            "delayed",
            "waiting-children",
            "failed",
        );
        if (
            ["waiting", "active", "delayed", "waiting-children"].some(
                (key) => counts[key] > 0,
            )
        )
            return false;
        if (!counts.failed) return true;
        return (
            (await (
                await this.queue.client
            ).get(this.queue.toKey("catalog-failure-ack"))) ===
            (await this.failureFingerprint())
        );
    }
    async acknowledgeFailures(): Promise<void> {
        await (
            await this.queue.client
        ).set(
            this.queue.toKey("catalog-failure-ack"),
            await this.failureFingerprint(),
        );
    }
}
