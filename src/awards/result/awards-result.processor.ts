import { Processor } from "@nestjs/bullmq";
import { AWARDS_RESULT_QUEUE_NAME } from "./constants";
import { AwardsService } from "../awards.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import dayjs from "dayjs";
import { AwardsEvent } from "../entity/awards-event.entity";
import { DataSource } from "typeorm";
import { AwardsResultService } from "./awards-result.service";
import { VotableAwardsCategoryDto } from "../dto/votable-awards-category.dto";

@Processor(AWARDS_RESULT_QUEUE_NAME)
export class AwardsResultProcessor extends WorkerHostProcessor {
    constructor(
        private readonly awardsService: AwardsService,
        private readonly awardsResultService: AwardsResultService,
        private readonly dataSource: DataSource,
    ) {
        super();
    }

    async process() {
        const currentYearEvent = await this.awardsService.getRunningEvent();
        if (
            currentYearEvent != undefined &&
            dayjs(currentYearEvent.resultsDate).isSame(dayjs(), "day")
        ) {
            this.logger.log(
                "Processing results for event " + currentYearEvent.id,
            );
            await this.processEventResults(currentYearEvent);
        }
    }

    async processEventResults(event: AwardsEvent) {
        const categories = await this.awardsService.getCategoriesByEventId(
            event.id,
        );
        this.logger.log(`Found ${categories.length} for event ${event.id}`);

        for (const category of categories) {
            await this.processCategoryResult(category);
        }
    }

    async processCategoryResult(category: VotableAwardsCategoryDto) {
        this.logger.log(`Processing category ${category.id}`);
        // language=MySQL
        const categoryVoteCountsResult: {
            gameId: number;
            votes: number;
            votesPct: number;
            position: number;
        }[] = await this.dataSource.sql`-- Counting of votes per game
            SELECT
                av.gameId,
                ROW_NUMBER() OVER (ORDER BY COUNT(1) DESC) as position,
                COUNT(1)                                   AS votes,
                COUNT(1) / SUM(COUNT(1)) OVER ()           AS votesPct
            FROM awards_vote av
            WHERE av.categoryId = ${category.id}
            GROUP BY av.gameId
            ORDER BY votes DESC
            LIMIT 10`;

        // language=MySQL
        const categoryVoteStatisticsResult: {
            totalVotes: number;
            totalUniqueUserVotes: number;
            totalUniqueGames: number;
        }[] = await this.dataSource.sql`SELECT COUNT(av.id) as totalVotes, 
                        COUNT(DISTINCT av.profileUserId) as totalUniqueUserVotes, 
                        COUNT(DISTINCT av.gameId) as totalUniqueGames
                 FROM awards_vote av
                 WHERE av.categoryId = ${category.id}`;

        const categoryVoteStatistics = categoryVoteStatisticsResult.at(0);

        const categoryResult =
            await this.awardsResultService.createCategoryResult({
                categoryId: category.id,
                totalUniqueGamesSubmitted:
                    categoryVoteStatistics?.totalUniqueGames ?? 0,
                totalUsersParticipating:
                    categoryVoteStatistics?.totalUniqueUserVotes ?? 0,
                totalVotesCount: categoryVoteStatistics?.totalVotes ?? 0,
            });
        this.logger.log(
            `Registered category result for category ${category.id}`,
        );

        for (const voteResult of categoryVoteCountsResult) {
            this.logger.log(
                `Registering category winner for category ${category.id} -> game ${voteResult.gameId} with position ${voteResult.position}`,
            );
            await this.awardsResultService.registerCategoryWinner({
                resultId: categoryResult.id,
                gameId: voteResult.gameId,
                position: voteResult.position,
                totalVotes: voteResult.votes,
                votesPercentage: voteResult.votesPct,
            });
        }
    }
}
