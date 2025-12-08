import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindManyOptions,
    FindOptionsRelations,
    OrderByCondition,
    Repository,
} from "typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { FindPlaytimeOptionsDto } from "./dto/find-all-playtime.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { UserCumulativePlaytimeDto } from "./dto/user-cumulative-playtime.dto";
import {
    CreateUserPlaytimeDto,
    SubmitUserPlaytimeDto,
} from "./dto/create-user-playtime.dto";
import {
    PlaytimeFilterPeriodToMinusDays,
    UserPlaytimeSource,
} from "./playtime.constants";
import { FindAllPlaytimeFiltersDto } from "./dto/find-all-playtime-filters.dto";
import { getPreviousDate } from "../statistics/statistics.utils";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { toCumulativePlaytime } from "./playtime.util";
import { UserPlaytimeDto } from "./dto/user-playtime.dto";
import { generateChecksum } from "../utils/checksum";
import dayjs from "dayjs";

const createChecksum = (dto: CreateUserPlaytimeDto) => {
    const relevantData = {
        profileUserId: dto.profileUserId,
        gameId: dto.gameId,
        source: dto.source,
        platformId: dto.platformId,
        totalPlaytimeSeconds: dto.totalPlaytimeSeconds,
        recentPlaytimeSeconds: dto.recentPlaytimeSeconds,
        lastPlayedDate: dto.lastPlayedDate,
        totalPlayCount: dto.totalPlayCount,
        firstPlayedDate: dto.firstPlayedDate,
    };

    return generateChecksum(relevantData);
};

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);
    private readonly relations: FindOptionsRelations<UserPlaytime> = {
        platform: true,
    };

    constructor(
        @InjectRepository(UserPlaytime)
        private readonly userPlaytimeRepository: Repository<UserPlaytime>,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    public async findOne(
        userId: string,
        gameId: number,
        source: UserPlaytimeSource,
        platformId: number,
    ) {
        return await this.userPlaytimeRepository.findOne({
            where: {
                profileUserId: userId,
                gameId,
                source,
                platformId,
            },
            relations: this.relations,
        });
    }

    public async getTotalPlaytimeByUserId(
        userId: string,
        criteria: "totalPlaytimeSeconds" | "recentPlaytimeSeconds",
        source?: UserPlaytimeSource,
        platformId?: number,
    ): Promise<number> {
        const qb = this.userPlaytimeRepository.createQueryBuilder("up");
        qb.select(`SUM(up.${criteria})`, "total").where(
            "up.profileUserId = :userId",
            { userId },
        );
        if (source) {
            qb.andWhere("up.source = :source", { source });
        }
        if (platformId) {
            qb.andWhere("up.platformId = :platformId", { platformId });
        }

        const result = await qb.getRawOne<{ total: number }>();

        return result?.total ?? 0;
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
    ): Promise<TPaginationData<UserPlaytimeDto>> {
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
    ): Promise<TPaginationData<UserPlaytimeDto>> {
        const baseFindOptions = buildBaseFindOptions<UserPlaytime>(options);

        const periodToMinusDay =
            PlaytimeFilterPeriodToMinusDays[options.period];

        const periodDate = getPreviousDate(periodToMinusDay);

        const qb = this.userPlaytimeRepository
            .createQueryBuilder("up")
            .where("up.profileUserId = :profileUserId")
            .andWhere("up.lastPlayedDate >= :lastPlayedDate")
            .leftJoinAndSelect("up.platform", "platform")
            .skip(baseFindOptions.skip)
            .limit(baseFindOptions.take);

        if (options.orderBy) {
            const orderObj: OrderByCondition = {};

            for (const [key, v] of Object.entries(options.orderBy)) {
                if (v) {
                    orderObj[key] = v;
                }
            }

            qb.orderBy(orderObj);
        }

        qb.setParameters({
            profileUserId: userId,
            lastPlayedDate: periodDate,
        });

        return await qb.getManyAndCount();
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

    private async getRecentPlaytimeForGame(playtime: CreateUserPlaytimeDto) {
        const totalPerGame =
            await this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                userId: playtime.profileUserId,
                source: playtime.source,
                platformId: playtime.platformId,
                startDate: getPreviousDate(14),
                endDate: new Date(),
            });

        const playtimeForGame = totalPerGame.find(
            (entry) => entry.gameId === playtime.gameId,
        );

        return playtimeForGame?.totalPlaytimeInPeriodSeconds ?? 0;
    }

    async save(playtime: CreateUserPlaytimeDto) {
        const existingPlaytime = await this.findOne(
            playtime.profileUserId,
            playtime.gameId,
            playtime.source,
            playtime.platformId,
        );

        const updatedChecksum = createChecksum(playtime);

        /**
         * If the checksum matches and the entry was updated in the last 14 days, skip updating
         * to reduce unnecessary writes.
         */
        if (
            existingPlaytime != undefined &&
            existingPlaytime.checksum === updatedChecksum &&
            dayjs(existingPlaytime.updatedAt).diff(dayjs(), "day") < 14
        ) {
            this.logger.log(
                `Skipping playtime update: no changes detected. (profile: ${playtime.profileUserId}, game: ${playtime.gameId}, source: ${playtime.source}, platform: ${playtime.platformId})`,
            );
            return existingPlaytime;
        }

        const updatedPlaytime = {
            ...existingPlaytime,
            ...playtime,
        };

        await this.playtimeHistoryService.save(updatedPlaytime);

        let recentPlaytimeSeconds = playtime.recentPlaytimeSeconds;
        if (recentPlaytimeSeconds == undefined) {
            recentPlaytimeSeconds =
                await this.getRecentPlaytimeForGame(updatedPlaytime);
        }

        return await this.userPlaytimeRepository.save({
            ...updatedPlaytime,
            recentPlaytimeSeconds,
            checksum: updatedChecksum,
        });
    }

    async submit(userId: string, dto: SubmitUserPlaytimeDto) {
        return await this.save({
            profileUserId: userId,
            gameId: dto.gameId,
            lastPlayedDate: dto.lastPlayedDate,
            totalPlaytimeSeconds: dto.totalPlaytimeSeconds,
            platformId: dto.platformId,
            source: dto.source,
            recentPlaytimeSeconds: undefined,
            firstPlayedDate: undefined,
            totalPlayCount: undefined,
        });
    }
}
