import { Module } from "@nestjs/common";
import { PlaytimeEstimateService } from "./playtime-estimate.service";
import { PlaytimeEstimateController } from "./playtime-estimate.controller";

/**
 * This module is basically our HLTB equivalent
 * for user submissions on how long a game can be completed, and in what categories.
 */
@Module({
    providers: [PlaytimeEstimateService],
    controllers: [PlaytimeEstimateController],
})
export class PlaytimeEstimateModule {}
