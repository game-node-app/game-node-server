import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { RegisterAwardsVoteDto } from "../dto/register-awards-vote.dto";
import { AwardsService } from "../awards.service";
import { InjectRepository } from "@nestjs/typeorm";
import { AwardsVote } from "../entity/awards-vote.entity";
import { Repository } from "typeorm";
import dayjs from "dayjs";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { toMap } from "../../utils/toMap";
import { Cacheable } from "../../utils/cacheable";
import { minutes } from "@nestjs/throttler";
import { AchievementsQueueService } from "../../achievements/achievements-queue/achievements-queue.service";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { assertGameEligible, getAwardsPhase } from "../awards.utils";

@Injectable()
export class AwardsVoteService {
    constructor(
        @InjectRepository(AwardsVote)
        private readonly awardsVoteRepository: Repository<AwardsVote>,
        private readonly awardsService: AwardsService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly achievementsQueueService: AchievementsQueueService,
        @InjectRepository(AwardsCategorySuggestion)
        private readonly awardsCategorySuggestionRepository: Repository<AwardsCategorySuggestion>,
    ) {}

    /**
     * Registers or updates a vote for a given category
     * @param userId
     * @param dto
     */
    public async registerVote(userId: string, dto: RegisterAwardsVoteDto) {
        const category = await this.awardsService.getCategoryByIdOrFail(
            dto.categoryId,
        );
        const targetEvent = await this.awardsService.getEventByIdOrFail(
            category.eventId,
        );
        const now = dayjs();

        switch (getAwardsPhase(targetEvent, now.toDate())) {
            case "upcoming":
            case "nominations":
            case "nominations_closed":
                throw new HttpException(
                    "Voting period has not started yet.",
                    HttpStatus.BAD_REQUEST,
                );
            case "voting_closed":
            case "results":
                throw new HttpException(
                    "Voting period has ended.",
                    HttpStatus.BAD_REQUEST,
                );
        }

        const targetGame = await this.gameRepositoryService.findOneByIdOrFail(
            dto.gameId,
        );
        assertGameEligible(targetEvent, targetGame);

        // Events with a nominations phase only accept the category's nominees.
        const hasNominations =
            targetEvent.nominationStartDate != null &&
            targetEvent.nominationEndDate != null;
        if (hasNominations && !category.isPersonalGOTY) {
            const isNominee =
                await this.awardsCategorySuggestionRepository.existsBy({
                    categoryId: category.id,
                    gameId: targetGame.id,
                });
            if (!isNominee) {
                throw new HttpException(
                    `Game ${targetGame.name} is not a nominee in the ${category.name} category.`,
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        // If a vote for this category is already in place, it will be updated instead.
        const existingVote = await this.awardsVoteRepository.findOneBy({
            profileUserId: userId,
            categoryId: dto.categoryId,
        });

        await this.awardsVoteRepository.save({
            id: existingVote?.id,
            profileUserId: userId,
            categoryId: dto.categoryId,
            gameId: dto.gameId,
        });

        for (const metric of [
            "awards_participation",
            "awards_ballot_completed",
        ] as const) {
            this.achievementsQueueService.addTrackingJob({ userId, metric });
        }
    }

    public async getVoteByUserId(userId: string, categoryId: number) {
        return this.awardsVoteRepository.findOneOrFail({
            where: {
                categoryId,
                profileUserId: userId,
            },
        });
    }

    @Cacheable(AwardsVoteService.name, minutes(10))
    public async getRecentVotesByEventId(eventId: number) {
        const votesInEvent = await this.awardsVoteRepository.find({
            where: {
                category: {
                    eventId: eventId,
                },
            },
            relations: {
                category: {
                    event: true,
                    translations: true,
                },
            },
            order: {
                // ASC so last elements appear last in list (and are then present in map)
                createdAt: "ASC",
            },
        });

        const mappedByUserId = toMap(votesInEvent, "profileUserId");

        return Array.from(mappedByUserId.values()).slice(0, 10);
    }
}
