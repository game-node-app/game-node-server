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
import { AchievementCategory } from "../../achievements/achievements.constants";

@Injectable()
export class AwardsVoteService {
    constructor(
        @InjectRepository(AwardsVote)
        private readonly awardsVoteRepository: Repository<AwardsVote>,
        private readonly awardsService: AwardsService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly achievementsQueueService: AchievementsQueueService,
    ) {}

    /**
     * Registers or updates a vote for a given category
     * @param userId
     * @param dto
     */
    public async registerVote(userId: string, dto: RegisterAwardsVoteDto) {
        const targetEvent = await this.awardsService.getEventByCategoryId(
            dto.categoryId,
        );
        if (!targetEvent) {
            throw new HttpException("No running event", HttpStatus.BAD_REQUEST);
        }
        const now = dayjs();

        if (now.isAfter(targetEvent.votingEndDate, "second")) {
            throw new HttpException(
                "Voting period has ended",
                HttpStatus.BAD_REQUEST,
            );
        }
        if (now.isBefore(targetEvent.votingStartDate, "second")) {
            throw new HttpException(
                "Voting period has ended",
                HttpStatus.BAD_REQUEST,
            );
        }

        const targetGame = await this.gameRepositoryService.findOneByIdOrFail(
            dto.gameId,
        );

        if (
            targetGame.firstReleaseDate != undefined &&
            targetGame.firstReleaseDate.getFullYear() !== targetEvent.year
        ) {
            throw new HttpException(
                `Game ${targetGame.name} was released in ${targetGame.firstReleaseDate.getFullYear()} and is not part of the ${targetEvent.year} awards event.`,
                HttpStatus.BAD_REQUEST,
            );
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

        this.achievementsQueueService.addTrackingJob({
            category: AchievementCategory.EVENTS,
            targetUserId: userId,
        });
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
