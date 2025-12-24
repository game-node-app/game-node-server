import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { UserPlaytimeSource } from "./playtime.constants";
import { GetTotalPlaytimePeriodDto } from "./dto/get-total-playtime-period.dto";
import { Cache } from "@nestjs/cache-manager";
import { Cacheable } from "../utils/cacheable";
import { minutes } from "@nestjs/throttler";
import { PlaytimeInPeriod } from "./playtime.types";

@Injectable()
export class PlaytimeHistoryService {
    constructor(
        @InjectRepository(UserPlaytimeHistory)
        private readonly playtimeHistoryRepository: Repository<UserPlaytimeHistory>,
        private readonly cacheManager: Cache,
    ) {}

    public async findAllByUserId(
        userId: string,
        source?: UserPlaytimeSource,
        platformId?: number,
    ) {
        return await this.playtimeHistoryRepository.find({
            where: {
                profileUserId: userId,
                source,
                platformId,
            },
        });
    }

    public async findAllByUserIdAndGameId(
        userId: string,
        gameId: number,
        source?: UserPlaytimeSource,
        platformId?: number,
    ) {
        return await this.playtimeHistoryRepository.find({
            where: {
                profileUserId: userId,
                gameId: gameId,
                source,
                platformId,
            },
        });
    }

    @Cacheable(PlaytimeHistoryService.name, minutes(5))
    public async getTotalPlaytimeForPeriod(dto: GetTotalPlaytimePeriodDto) {
        const { userId, source, platformId, startDate, endDate } = dto;
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");

        qb.select("ph.gameId", "gameId")
            .addSelect("ph.source", "source")
            .addSelect("ph.platformId", "platformId")
            .addSelect(
                `MAX(ph.totalPlaytimeSeconds) - MIN(ph.totalPlaytimeSeconds)`,
                "totalPlaytimeInPeriodSeconds",
            )
            .groupBy("ph.gameId, ph.source, ph.platformId")
            .addGroupBy("ph.source")
            .where("ph.createdAt BETWEEN :startDate AND :endDate", {
                startDate,
                endDate,
            })
            .andWhere("ph.profileUserId = :userId", { userId });
        if (source) {
            qb.andWhere("ph.source = :source", { source });
        }
        if (platformId) {
            qb.andWhere("ph.platformId = :platformId", { platformId });
        }

        return await qb.getRawMany<PlaytimeInPeriod>();
    }

    public async save(playtime: CreateUserPlaytimeDto) {
        await this.playtimeHistoryRepository.insert({
            ...playtime,
            id: undefined,
        });
    }
}
