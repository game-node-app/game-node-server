import { Entity } from "typeorm";
import { SteamSyncService } from "../../../sync/steam/steam-sync.service";
import { WorkerHostProcessor } from "../../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

@Entity()
export class GameAchievementSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(GameAchievementSyncProcessor.name);

    constructor(private readonly steamSyncService: SteamSyncService) {
        super();
    }

    async process(job: Job, token: string | undefined): Promise<any> {
        return Promise.resolve(undefined);
    }
}
