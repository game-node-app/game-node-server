import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DeepPartial,
    FindManyOptions,
    FindOptionsRelations,
    MoreThanOrEqual,
    Repository,
} from "typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { FindPlaytimeOptionsDto } from "./dto/find-all-playtime.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { UserCumulativePlaytimeDto } from "./dto/user-cumulative-playtime.dto";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { UserPlaytimeSource } from "./playtime.constants";
import { getPreviousDate } from "../statistics/statistics.utils";

const toCumulativePlaytime = (
    userId: string,
    gameId: number,
    userPlaytimes: UserPlaytime[],
): UserCumulativePlaytimeDto => {
    const cumulativePlaytime: UserCumulativePlaytimeDto = {
        profileUserId: userId,
        gameId: gameId,
        recentPlaytimeSeconds: 0,
        totalPlayCount: 0,
        totalPlaytimeSeconds: 0,
        lastPlayedDate: undefined,
        firstPlayedDate: undefined,
    };

    if (userPlaytimes == undefined || userPlaytimes.length === 0) {
        return cumulativePlaytime;
    }

    for (const userPlaytime of userPlaytimes) {
        cumulativePlaytime.recentPlaytimeSeconds +=
            userPlaytime.recentPlaytimeSeconds;
        cumulativePlaytime.totalPlaytimeSeconds +=
            userPlaytime.totalPlaytimeSeconds;
        cumulativePlaytime.totalPlayCount += userPlaytime.totalPlayCount;
        if (
            userPlaytime.firstPlayedDate != undefined &&
            (cumulativePlaytime.firstPlayedDate == undefined ||
                cumulativePlaytime.firstPlayedDate.getTime() <
                    userPlaytime.firstPlayedDate.getTime())
        ) {
            cumulativePlaytime.firstPlayedDate = userPlaytime.firstPlayedDate;
        }

        if (
            userPlaytime.lastPlayedDate != undefined &&
            (cumulativePlaytime.lastPlayedDate == undefined ||
                cumulativePlaytime.lastPlayedDate.getTime() <
                    userPlaytime.lastPlayedDate.getTime())
        ) {
            cumulativePlaytime.lastPlayedDate = userPlaytime.lastPlayedDate;
        }
    }

    return cumulativePlaytime;
};

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);
    private readonly relations: FindOptionsRelations<UserPlaytime> = {
        externalGame: true,
    };

    constructor(
        @InjectRepository(UserPlaytime)
        private readonly userPlaytimeRepository: Repository<UserPlaytime>,
    ) {}

    public async findOneByExternalGame(userId: string, externalGameId: number) {
        return this.userPlaytimeRepository.findOne({
            where: {
                profileUserId: userId,
                externalGameId: externalGameId,
            },
            relations: this.relations,
        });
    }

    /**
     * Since a user may have the same game imported from more than one source, this method is preferred.
     * @param userId
     * @param gameId
     * @param options
     */
    public async findAllByUserIdAndGameId(userId: string, gameId: number) {
        return await this.userPlaytimeRepository.find({
            where: {
                profileUserId: userId,
                gameId: gameId,
            },
            relations: this.relations,
        });
    }

    public async findAccumulatedForUserIdAndGameId(
        userId: string,
        gameId: number,
    ) {
        const playtimes = await this.findAllByUserIdAndGameId(userId, gameId);

        return toCumulativePlaytime(userId, gameId, playtimes);
    }

    public async findAllByUserId(
        userId: string,
        dto?: FindPlaytimeOptionsDto,
    ): Promise<TPaginationData<UserPlaytime>> {
        const baseFindOptions = buildBaseFindOptions(dto);

        const options: FindManyOptions<UserPlaytime> = {
            ...baseFindOptions,
            where: {
                profileUserId: userId,
            },
            relations: this.relations,
            order: {
                lastPlayedDate: "DESC",
            },
        };

        if (dto?.onlyLatest) {
            options.where = {
                ...options.where,
                lastPlayedDate: MoreThanOrEqual(getPreviousDate(90)),
            };
        }

        return await this.userPlaytimeRepository.findAndCount(options);
    }

    /**
     * Returns a Map of accumulated playtime info for each game in 'gameIds' associated with a
     * 'userId'.
     * @param userId
     * @param gameIds
     */
    public async getPlaytimesMap(userId: string, gameIds: number[]) {
        const playtimeMap = new Map<number, UserCumulativePlaytimeDto>();
        for (const gameId of gameIds) {
            const entriesInGameId = await this.findAllByUserIdAndGameId(
                userId,
                gameId,
            );
            playtimeMap.set(
                gameId,
                toCumulativePlaytime(userId, gameId, entriesInGameId),
            );
        }

        return playtimeMap;
    }

    async save(playtime: CreateUserPlaytimeDto) {
        return await this.userPlaytimeRepository.save(playtime);
    }

    async deleteForSource(userId: string, source: UserPlaytimeSource) {
        return await this.userPlaytimeRepository.delete({
            profileUserId: userId,
            source: source,
        });
    }
}
