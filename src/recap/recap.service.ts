import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { YearRecap } from "./entity/year-recap.entity";
import { In, RelationOptions, Repository } from "typeorm";
import { FindOptionsRelations } from "typeorm/find-options/FindOptionsRelations";

@Injectable()
export class RecapService {
    private readonly relations: FindOptionsRelations<YearRecap> = {
        platforms: true,
        playedGames: true,
        genres: true,
        modes: true,
        themes: true,
    };

    constructor(
        @InjectRepository(YearRecap)
        private readonly recapRepository: Repository<YearRecap>,
    ) {}

    public async findAllByUserIds(userIds: string[]): Promise<YearRecap[]> {
        return this.recapRepository.find({
            where: {
                profileUserId: In(userIds),
            },
        });
    }
}
