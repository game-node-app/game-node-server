import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { DailyController } from "./daily.controller";
import { DailyService } from "./daily.service";
import { DailyPoolService } from "./daily-pool.service";
import { DailyScheduler } from "./daily.scheduler";

@Module({
    imports: [TypeOrmModule.forFeature([DailyPuzzle, DailyResult])],
    providers: [DailyService, DailyPoolService, DailyScheduler],
    controllers: [DailyController],
})
export class DailyModule {}
