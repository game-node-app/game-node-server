import { InjectRepository } from "@nestjs/typeorm";
import { AwardsCategoryResult } from "../entity/awards-category-result.entity";
import { Repository } from "typeorm";
import { AwardsCategoryResultWinner } from "../entity/awards-category-winner.entity";
import { Injectable } from "@nestjs/common";

@Injectable()
export class AwardsResultService {
    constructor(
        @InjectRepository(AwardsCategoryResult)
        private readonly awardsCategoryResultRepository: Repository<AwardsCategoryResult>,
        @InjectRepository(AwardsCategoryResultWinner)
        private readonly awardsCategoryResultWinnerRepository: Repository<AwardsCategoryResultWinner>,
    ) {}

    public async createCategoryResult(entity: Partial<AwardsCategoryResult>) {
        return await this.awardsCategoryResultRepository.save(entity);
    }

    public async registerCategoryWinner(
        entity: Partial<AwardsCategoryResultWinner>,
    ) {
        return await this.awardsCategoryResultWinnerRepository.save(entity);
    }
}
