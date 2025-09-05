import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { RegisterAwardsVoteDto } from "../dto/register-awards-vote.dto";
import { AwardsService } from "../awards.service";
import { InjectRepository } from "@nestjs/typeorm";
import { AwardsVote } from "../entity/awards-vote.entity";
import { Repository } from "typeorm";

@Injectable()
export class AwardsVoteService {
    constructor(
        @InjectRepository(AwardsVote)
        private readonly awardsVoteRepository: Repository<AwardsVote>,
        private readonly awardsService: AwardsService,
    ) {}

    /**
     * Registers or updates a vote for a given category
     * @param userId
     * @param dto
     */
    public async registerVote(userId: string, dto: RegisterAwardsVoteDto) {
        const targetEvent = await this.awardsService.getRunningVotableEvent();
        if (!targetEvent) {
            throw new HttpException("No running event", HttpStatus.BAD_REQUEST);
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
    }

    public async getVotesByUserId(userId: string, categoryId: number) {
        return this.awardsVoteRepository.find({
            where: {
                categoryId,
                profileUserId: userId,
            },
        });
    }
}
