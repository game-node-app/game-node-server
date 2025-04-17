import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
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
import {
    SubmitUserPlaytimeDto,
    CreateUserPlaytimeDto,
} from "./dto/create-user-playtime.dto";
import {
    PlaytimeFilterPeriodToMinusDays,
    PlaytimeFiterPeriod,
    UserPlaytimeSource,
} from "./playtime.constants";
import { FindAllPlaytimeFiltersDto } from "./dto/find-all-playtime-filters.dto";
import { getPreviousDate } from "../statistics/statistics.utils";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { toCumulativePlaytime } from "./playtime.util";

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);
    private readonly relations: FindOptionsRelations<UserPlaytime> = {};

    constructor(
        @InjectRepository(UserPlaytime)
        private readonly userPlaytimeRepository: Repository<UserPlaytime>,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    public async findOneByExternalGame(userId: string, externalGameId: number) {
        return this.userPlaytimeRepository.findOne({
            where: {
                profileUserId: userId,
            },
            relations: this.relations,
        });
    }

    public async findOneBySource(
        userId: string,
        gameId: number,
        source: UserPlaytimeSource,
    ) {
        return this.userPlaytimeRepository.findOne({
            where: {
                profileUserId: userId,
                gameId,
                source,
            },
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

        return await this.userPlaytimeRepository.findAndCount(options);
    }

    public async findAllByUserIdWithFilters(
        userId: string,
        options: FindAllPlaytimeFiltersDto,
    ): Promise<TPaginationData<UserPlaytime>> {
        const baseFindOptions = buildBaseFindOptions<UserPlaytime>(options);

        const periodToMinusDay =
            PlaytimeFilterPeriodToMinusDays[options.period];

        const periodDate = getPreviousDate(periodToMinusDay);

        const periodFilter =
            options.period !== PlaytimeFiterPeriod.ALL
                ? MoreThanOrEqual(periodDate)
                : undefined;

        return this.userPlaytimeRepository.findAndCount({
            ...baseFindOptions,
            where: {
                profileUserId: userId,
                lastPlayedDate: periodFilter,
            },
            relations: this.relations,
        });
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
        const existingPlaytime = this.findOneBySource(
            playtime.profileUserId,
            playtime.gameId,
            playtime.source,
        );

        const updatedPlaytime = {
            ...existingPlaytime,
            ...playtime,
        };

        await this.playtimeHistoryService.save(updatedPlaytime);

        const weekAgoDate = getPreviousDate(7);

        const recentPlaytimeSeconds =
            await this.playtimeHistoryService.getRecentPlaytimeSincePeriod(
                playtime.profileUserId,
                playtime.source,
                weekAgoDate,
            );

        return await this.userPlaytimeRepository.save({
            ...updatedPlaytime,
            recentPlaytimeSeconds,
        });
    }

    async submit(userId: string, dto: SubmitUserPlaytimeDto) {
        return await this.save({
            profileUserId: userId,
            gameId: dto.gameId,
            source: dto.source,
            lastPlayedDate: dto.lastPlayedDate,
            totalPlaytimeSeconds: dto.totalPlaytimeSeconds,
            firstPlayedDate: undefined,
            totalPlayCount: undefined,
        });
    }

    async deleteForSource(userId: string, source: UserPlaytimeSource) {
        return await this.userPlaytimeRepository.delete({
            profileUserId: userId,
            source: source,
        });
    }
}
