import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { UserPlaytimeSource } from "./playtime.constants";
import { GetTotalPlaytimePeriodDto } from "./dto/get-total-playtime-period.dto";
import { Cache } from "@nestjs/cache-manager";
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

    public async getTotalPlaytimeForPeriod(dto: GetTotalPlaytimePeriodDto) {
        const { userId, source, platformId, startDate, endDate } = dto;
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");
        const previous = qb
            .subQuery()
            .select("previous.totalPlaytimeSeconds")
            .from(UserPlaytimeHistory, "previous")
            .where("previous.profileUserId = ph.profileUserId")
            .andWhere("previous.gameId = ph.gameId")
            .andWhere("previous.source = ph.source")
            .andWhere("previous.platformId = ph.platformId")
            .andWhere(
                "(previous.createdAt < ph.createdAt OR (previous.createdAt = ph.createdAt AND previous.id < ph.id))",
            )
            .orderBy("previous.createdAt", "DESC")
            .addOrderBy("previous.id", "DESC")
            .limit(1)
            .getQuery();

        qb.select("ph.gameId", "gameId")
            .addSelect("ph.source", "source")
            .addSelect("ph.platformId", "platformId")
            .addSelect(
                // Unknown first samples contribute zero; corrections establish the next baseline.
                `COALESCE(SUM(GREATEST(ph.totalPlaytimeSeconds - ${previous}, 0)), 0)`,
                "totalPlaytimeInPeriodSeconds",
            )
            .groupBy("ph.gameId, ph.source, ph.platformId")
            .where("ph.createdAt > :startDate AND ph.createdAt <= :endDate", {
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

        const totals = await qb.getRawMany<PlaytimeInPeriod>();
        // MySQL returns SUM as a decimal string, while callers add numeric seconds.
        return totals.map((total) => ({
            ...total,
            gameId: Number(total.gameId),
            platformId: Number(total.platformId),
            totalPlaytimeInPeriodSeconds: Number(
                total.totalPlaytimeInPeriodSeconds,
            ),
        }));
    }

    public async save(playtime: CreateUserPlaytimeDto, observedAt: Date) {
        await this.playtimeHistoryRepository.insert({
            ...playtime,
            id: undefined,
            createdAt: observedAt,
        });
    }
}
