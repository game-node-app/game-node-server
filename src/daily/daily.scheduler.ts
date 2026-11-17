import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, In, LessThan, QueryFailedError, Repository } from "typeorm";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import {
    DAILY_POOL_WINDOW,
    DailyPoolService,
    DailyPoolWindow,
    WEEKLY_POOL_WINDOW,
} from "./daily-pool.service";
import {
    addDays,
    DAILY_TIME_ZONE,
    dailyToday,
    DailyMode,
    DailyPuzzleKind,
    mondayOf,
    practiceRoundsCutoff,
} from "./daily.constants";
import { DailyRankingService } from "./daily-ranking.service";

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
        @InjectRepository(DailyPracticeRound)
        private readonly roundRepository: Repository<DailyPracticeRound>,
        private readonly rankingService: DailyRankingService,
    ) {}

    onApplicationBootstrap() {
        void this.bootstrap();
    }

    /** Puzzles first: the first boot fills the ranking from results and snapshots a ready table. */
    private async bootstrap() {
        const today = dailyToday();
        await this.ensurePuzzles();
        try {
            await this.rankingService.rebuildIfEmpty(today);
        } catch (error) {
            this.logger.error(error, "Daily ranking rebuild failed");
        }
        try {
            await this.rankingService.snapshotIfNeeded(today);
        } catch (error) {
            this.logger.error(error, "Daily ranking snapshot failed");
        }
    }

    @Cron("5 0 * * *", { timeZone: DAILY_TIME_ZONE })
    async ensurePuzzles(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.ensureDailyPuzzles();
            await this.ensureWeeklyPuzzles();
        } catch (error) {
            this.logger.error(error, "Daily puzzle generation failed");
        } finally {
            this.running = false;
        }
    }

    /** The previous positions of the day, once every finish of yesterday is committed. */
    @Cron("0 0 * * *", { timeZone: DAILY_TIME_ZONE })
    async snapshotRanking(): Promise<void> {
        try {
            await this.rankingService.snapshotIfNeeded(dailyToday());
        } catch (error) {
            this.logger.error(error, "Daily ranking snapshot failed");
        }
    }

    /** Practice rounds live a week; past ranking partitions and snapshots are read by nothing. */
    @Cron("35 0 * * *", { timeZone: DAILY_TIME_ZONE })
    async cleanupPracticeRounds(): Promise<void> {
        try {
            await this.roundRepository.delete({
                createdAt: LessThan(practiceRoundsCutoff()),
            });
        } catch (error) {
            this.logger.error(error, "Daily practice cleanup failed");
        }
        try {
            await this.rankingService.cleanup(dailyToday());
        } catch (error) {
            this.logger.error(error, "Daily ranking cleanup failed");
        }
    }

    private async ensureDailyPuzzles() {
        const today = dailyToday();
        const dates = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) =>
            addDays(today, i),
        );
        for (const mode of Object.values(DailyMode)) {
            const existing = await this.puzzleRepository.find({
                select: { date: true },
                where: {
                    kind: "daily",
                    mode,
                    date: Between(today, dates[DAYS_AHEAD]),
                },
            });
            const existingDates = new Set(
                existing.map((puzzle) => puzzle.date),
            );
            for (const date of dates) {
                if (!existingDates.has(date))
                    await this.createPuzzle(
                        "daily",
                        mode,
                        date,
                        DAILY_POOL_WINDOW,
                    );
            }
        }
    }

    /** This and next week's challenge, each dated on the Monday of its week. */
    private async ensureWeeklyPuzzles() {
        const monday = mondayOf(dailyToday());
        const dates = [monday, addDays(monday, 7)];
        const existing = await this.puzzleRepository.find({
            select: { date: true },
            where: { kind: "weekly", date: In(dates) },
        });
        const existingDates = new Set(existing.map((puzzle) => puzzle.date));
        for (const date of dates) {
            if (!existingDates.has(date))
                await this.createPuzzle(
                    "weekly",
                    DailyMode.SPECS,
                    date,
                    WEEKLY_POOL_WINDOW,
                );
        }
    }

    private async createPuzzle(
        kind: DailyPuzzleKind,
        mode: DailyMode,
        date: string,
        poolWindow: DailyPoolWindow,
    ) {
        const picked = await this.poolService.pick(mode, date, poolWindow);
        if (!picked) {
            this.logger.warn(
                `No eligible game left for the ${kind} ${mode} puzzle of ${date}`,
            );
            return;
        }
        const { max } = (await this.puzzleRepository
            .createQueryBuilder("puzzle")
            .select("MAX(puzzle.number)", "max")
            .where("puzzle.kind = :kind AND puzzle.mode = :mode", {
                kind,
                mode,
            })
            .getRawOne())!;
        try {
            await this.puzzleRepository.insert({
                kind,
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
