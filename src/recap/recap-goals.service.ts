import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { YearGoal } from "./entity/year-goal.entity";
import { RecapGoalDto } from "./dto/recap-goal.dto";

@Injectable()
export class RecapGoalsService {
    constructor(
        @InjectRepository(YearGoal)
        private readonly goalRepository: Repository<YearGoal>,
        private readonly dataSource: DataSource,
    ) {}

    public async getGoal(userId: string, year: number): Promise<RecapGoalDto> {
        const [goal, counts] = await Promise.all([
            this.goalRepository.findOneBy({ profileUserId: userId, year }),
            this.dataSource.query(
                `SELECT COUNT(*) AS finished FROM collection_entry
                 WHERE libraryUserId = ? AND finishedAt >= ? AND finishedAt < ?`,
                [
                    userId,
                    new Date(Date.UTC(year, 0, 1)),
                    new Date(Date.UTC(year + 1, 0, 1)),
                ],
            ),
        ]);

        return {
            year,
            target: goal?.finishedGamesTarget ?? null,
            finished: Number(counts[0].finished),
        };
    }

    public async setGoal(
        userId: string,
        year: number,
        target: number,
        now = new Date(),
    ): Promise<RecapGoalDto> {
        const currentYear = now.getUTCFullYear();
        if (year !== currentYear && year !== currentYear + 1) {
            throw new BadRequestException(
                "Goals can only be set for the current or next year.",
            );
        }

        await this.goalRepository.upsert(
            { profileUserId: userId, year, finishedGamesTarget: target },
            ["profileUserId", "year"],
        );

        return this.getGoal(userId, year);
    }
}
