import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DAILY_TIME_ZONE } from "../daily/daily.constants";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";

@Injectable()
export class GuildScheduler {
    private readonly logger = new Logger(GuildScheduler.name);

    constructor(
        private readonly evaluatorService: GuildContractEvaluatorService,
    ) {}

    @Cron("15 * * * *", { timeZone: DAILY_TIME_ZONE })
    async expireOverdueContracts(): Promise<void> {
        try {
            await this.evaluatorService.expireOverdueContracts();
        } catch (error) {
            this.logger.error(
                `Guild contract expiration failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
