import { InjectRepository } from "@nestjs/typeorm";
import { AwardsCategoryResult } from "../entity/awards-category-result.entity";
import { Not, Repository } from "typeorm";
import { Injectable, NotFoundException } from "@nestjs/common";
import { AwardsVote } from "../entity/awards-vote.entity";
import { AwardsCategory } from "../entity/awards-category.entity";

export type AwardsScoreboardOutcome = "hit" | "miss" | "not_voted";

export interface AwardsScoreboardDto {
    totals: {
        hits: number;
        voted: number;
        scorable: number;
    };
    categories: {
        categoryId: number;
        votedGameId: number | null;
        winningGameId: number | null;
        outcome: AwardsScoreboardOutcome;
    }[];
    personalGOTY: {
        gameId: number;
        otherUsersCount: number;
    } | null;
}

@Injectable()
export class AwardsResultService {
    constructor(
        @InjectRepository(AwardsCategoryResult)
        private readonly awardsCategoryResultRepository: Repository<AwardsCategoryResult>,
        @InjectRepository(AwardsVote)
        private readonly awardsVoteRepository: Repository<AwardsVote>,
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
    ) {}

    public async getCategoryResultsByEventId(eventId: number) {
        return this.awardsCategoryResultRepository.find({
            where: {
                category: {
                    eventId: eventId,
                },
            },
            relations: {
                category: true,
                winners: true,
            },
            order: { category: { id: "ASC" }, winners: { position: "ASC" } },
        });
    }

    /**
     * Results are complete only when every category of the event has a row, so a
     * partially computed legacy event is repaired instead of being published.
     */
    public async eventHasResults(eventId: number): Promise<boolean> {
        const [categories, results] = await Promise.all([
            this.awardsCategoryRepository.countBy({ eventId }),
            this.awardsCategoryResultRepository.count({
                where: { category: { eventId } },
            }),
        ]);
        return categories > 0 && results >= categories;
    }

    /**
     * Computed on read (design 7): the user's vote against the position-1 winner.
     * 404 while no result exists, which also covers an unknown event.
     */
    public async getScoreboard(
        eventId: number,
        userId: string,
    ): Promise<AwardsScoreboardDto> {
        const results = await this.getCategoryResultsByEventId(eventId);
        if (results.length === 0) {
            throw new NotFoundException("Results are not available yet.");
        }

        const votes = await this.awardsVoteRepository.find({
            where: { profileUserId: userId, category: { eventId } },
        });
        const votesByCategory = new Map(
            votes.map((vote) => [vote.categoryId, Number(vote.gameId)]),
        );

        let hits = 0;
        let voted = 0;
        let personalGOTY: AwardsScoreboardDto["personalGOTY"] = null;
        const categories: AwardsScoreboardDto["categories"] = [];

        for (const result of results) {
            const votedGameId = votesByCategory.get(result.categoryId) ?? null;

            if (result.category.isPersonalGOTY) {
                if (votedGameId != null) {
                    personalGOTY = {
                        gameId: votedGameId,
                        otherUsersCount:
                            await this.awardsVoteRepository.countBy({
                                categoryId: result.categoryId,
                                gameId: votedGameId,
                                profileUserId: Not(userId),
                            }),
                    };
                }
                continue;
            }

            const winningGameId =
                result.winners.find((winner) => winner.position === 1)
                    ?.gameId ?? null;
            const outcome: AwardsScoreboardOutcome =
                votedGameId == null
                    ? "not_voted"
                    : Number(winningGameId) === votedGameId
                      ? "hit"
                      : "miss";
            if (votedGameId != null) voted++;
            if (outcome === "hit") hits++;
            categories.push({
                categoryId: result.categoryId,
                votedGameId,
                winningGameId:
                    winningGameId == null ? null : Number(winningGameId),
                outcome,
            });
        }

        return {
            totals: { hits, voted, scorable: categories.length },
            categories,
            personalGOTY,
        };
    }
}
