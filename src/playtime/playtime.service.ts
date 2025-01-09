import { HttpException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DeepPartial, FindOptionsRelations, Repository } from "typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { FindAllPlaytimeRequestDto } from "./dto/find-all-playtime.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { HttpStatusCode } from "axios";

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);
    private readonly relations: FindOptionsRelations<UserPlaytime> = {
        externalGames: true,
    };

    constructor(
        @InjectRepository(UserPlaytime)
        private readonly userPlaytimeRepository: Repository<UserPlaytime>,
    ) {}

    public async findOne(userId: string, gameId: number) {
        return this.userPlaytimeRepository.findOne({
            where: {
                profileUserId: userId,
                gameId: gameId,
            },
            relations: this.relations,
        });
    }

    async findOneOrFail(userId: string, gameId: number) {
        const playtime = await this.findOne(userId, gameId);
        if (!playtime) {
            throw new HttpException(
                "No playtime associated with userId for game.",
                HttpStatusCode.BadRequest,
            );
        }

        return playtime;
    }

    public async findAllByUserId(
        dto: FindAllPlaytimeRequestDto,
    ): Promise<TPaginationData<UserPlaytime>> {
        const baseFindOptions = buildBaseFindOptions(dto);

        return await this.userPlaytimeRepository.findAndCount({
            ...baseFindOptions,
            where: {
                profileUserId: dto.userId,
            },
            relations: this.relations,
        });
    }

    public getPlaytimesMap(userId: string, gameIds: number[]) {
        return new Map<number, UserPlaytime>();
    }

    async save(playtime: DeepPartial<UserPlaytime>) {
        return await this.userPlaytimeRepository.save(playtime);
    }
}
