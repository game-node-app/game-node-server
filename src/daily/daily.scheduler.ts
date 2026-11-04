import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, QueryFailedError, Repository } from "typeorm";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyPoolService } from "./daily-pool.service";
import {
    addDays,
    DAILY_TIME_ZONE,
    dailyToday,
    DailyMode,
} from "./daily.constants";

/** Puzzles are created this many days ahead, so a failed run doesn't leave a day empty. */
const DAYS_AHEAD = 7;

@Injectable()
export class DailyScheduler implements OnApplicationBootstrap {
    private readonly logger = new Logger(DailyScheduler.name);
    private running = false;

    constructor(
        @InjectRepository(DailyPuzzle)
        private readonly puzzleRepository: Repository<DailyPuzzle>,
        private readonly poolService: DailyPoolService,
    ) {}

    onApplicationBootstrap() {
        void this.ensurePuzzles();
    }

    @Cron("5 0 * * *", { timeZone: DAILY_TIME_ZONE })
    async ensurePuzzles(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const today = dailyToday();
            const dates = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) =>
                addDays(today, i),
            );
            for (const mode of Object.values(DailyMode)) {
                const existing = await this.puzzleRepository.find({
                    select: { date: true },
                    where: { mode, date: Between(today, dates[DAYS_AHEAD]) },
                });
                const existingDates = new Set(
                    existing.map((puzzle) => puzzle.date),
                );
                for (const date of dates) {
                    if (!existingDates.has(date))
                        await this.createPuzzle(mode, date);
                }
            }
        } catch (error) {
            this.logger.error(error, "Daily puzzle generation failed");
        } finally {
            this.running = false;
        }
    }

    private async createPuzzle(mode: DailyMode, date: string) {
        const picked = await this.poolService.pick(mode, date);
        if (!picked) {
            this.logger.warn(
                `No eligible game left for the ${mode} puzzle of ${date}`,
            );
            return;
        }
        const { max } = (await this.puzzleRepository
            .createQueryBuilder("puzzle")
            .select("MAX(puzzle.number)", "max")
            .where("puzzle.mode = :mode", { mode })
            .getRawOne())!;
        try {
            await this.puzzleRepository.insert({
                mode,
                date,
                number: Number(max ?? 0) + 1,
                gameId: picked.gameId,
                meta: picked.meta,
                source: "auto",
            });
        } catch (error) {
            // Another replica created this puzzle (or took this number) first.
            if (
                !(error instanceof QueryFailedError) ||
                error.driverError?.code !== "ER_DUP_ENTRY"
            )
                throw error;
        }
    }
}
