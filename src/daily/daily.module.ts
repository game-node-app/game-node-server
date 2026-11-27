import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BillingModule } from "../billing/billing.module";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import { DailyRankingEntry } from "./entity/daily-ranking-entry.entity";
import { DailyRankingSnapshot } from "./entity/daily-ranking-snapshot.entity";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { DailyPoolService } from "./daily-pool.service";
import { DailyPracticeService } from "./daily-practice.service";
import { DailyScheduler } from "./daily.scheduler";
import { DailyRankingService } from "./daily-ranking.service";
import { GuildQueueModule } from "../guild/guild-queue/guild-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            DailyPuzzle,
            DailyResult,
            DailyPracticeRound,
            DailyRankingEntry,
            DailyRankingSnapshot,
        ]),
        BillingModule,
        GuildQueueModule,
    ],
    providers: [
        DailyService,
        DailyPoolService,
        DailyPracticeService,
        DailyScheduler,
        DailyRankingService,
    ],
    controllers: [DailyController],
})
export class DailyModule {}
