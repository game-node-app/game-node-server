import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { UserPlaytimeSource } from "./playtime.constants";
import { GetTotalPlaytimePeriodDto } from "./dto/get-total-playtime-period.dto";
import { Cache } from "@nestjs/cache-manager";
import { PlaytimeInPeriod } from "./playtime.types";

const STEAM_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const nonNegativeSeconds = (value: unknown) => {
    const seconds = Math.floor(Number(value));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

/**
 * Steam's recent total covers the 14 days before its first observation, so
 * spread it evenly and keep the part overlapping the window. Rounding both
 * cumulative edges conserves the total between adjacent windows.
 */
export function estimateSteamRecentPlaytimeSeconds(
    recentPlaytimeSeconds: unknown,
    totalPlaytimeSeconds: unknown,
    observedAt: Date,
    startDate: Date,
    endDate: Date,
) {
    const recent = Math.min(
        nonNegativeSeconds(recentPlaytimeSeconds),
        nonNegativeSeconds(totalPlaytimeSeconds),
    );
    const intervalStart = observedAt.getTime() - STEAM_RECENT_WINDOW_MS;
    const cumulative = (date: Date) => {
        const elapsed = Math.min(
            Math.max(date.getTime() - intervalStart, 0),
            STEAM_RECENT_WINDOW_MS,
        );
        return Math.round(recent * (elapsed / STEAM_RECENT_WINDOW_MS));
    };
    return cumulative(endDate) - cumulative(startDate);
}

type FirstSteamObservation = {
    gameId: number;
    source: UserPlaytimeSource;
    platformId: number;
    observedAt: Date;
    recentPlaytimeSeconds: number;
    totalPlaytimeSeconds: number;
};

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
        const estimates = await this.getFirstSteamObservationEstimates(dto);
        const merged = new Map<string, PlaytimeInPeriod>();
        for (const total of totals) {
            const gameId = Number(total.gameId);
            const platformId = Number(total.platformId);
            merged.set(`${gameId}:${platformId}:${total.source}`, {
                ...total,
                gameId,
                platformId,
                // MySQL returns SUM as a decimal string, while callers add numeric seconds.
                totalPlaytimeInPeriodSeconds: Number(
                    total.totalPlaytimeInPeriodSeconds,
                ),
            });
        }
        for (const estimate of estimates) {
            const seconds = estimateSteamRecentPlaytimeSeconds(
                estimate.recentPlaytimeSeconds,
                estimate.totalPlaytimeSeconds,
                estimate.observedAt,
                startDate,
                endDate,
            );
            if (seconds <= 0) continue;
            const gameId = Number(estimate.gameId);
            const platformId = Number(estimate.platformId);
            const key = `${gameId}:${platformId}:${estimate.source}`;
            const current = merged.get(key);
            if (current) {
                current.totalPlaytimeInPeriodSeconds += seconds;
                current.estimatedPlaytimeSeconds =
                    (current.estimatedPlaytimeSeconds ?? 0) + seconds;
            } else {
                merged.set(key, {
                    gameId,
                    source: estimate.source,
                    platformId,
                    totalPlaytimeInPeriodSeconds: seconds,
                    estimatedPlaytimeSeconds: seconds,
                } as PlaytimeInPeriod);
            }
        }
        return [...merged.values()];
    }

    private async getFirstSteamObservationEstimates(
        dto: GetTotalPlaytimePeriodDto,
    ) {
        const { userId, source, platformId, startDate, endDate } = dto;
        if (source != null && source !== UserPlaytimeSource.STEAM) return [];

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
            .getQuery();

        qb.select("ph.gameId", "gameId")
            .addSelect("ph.source", "source")
            .addSelect("ph.platformId", "platformId")
            .addSelect("ph.createdAt", "observedAt")
            .addSelect("ph.recentPlaytimeSeconds", "recentPlaytimeSeconds")
            .addSelect("ph.totalPlaytimeSeconds", "totalPlaytimeSeconds")
            .where(`NOT EXISTS ${previous}`)
            .andWhere("ph.profileUserId = :userId", { userId })
            .andWhere("ph.source = :steamSource", {
                steamSource: UserPlaytimeSource.STEAM,
            })
            .andWhere("ph.recentPlaytimeSeconds > 0")
            .andWhere("ph.createdAt > :startDate", { startDate })
            .andWhere("ph.createdAt < :bootstrapEndDate", {
                // A first observation up to one recent window after the period
                // end can still overlap it.
                bootstrapEndDate: new Date(
                    endDate.getTime() + STEAM_RECENT_WINDOW_MS,
                ),
            });
        if (platformId) {
            qb.andWhere("ph.platformId = :platformId", { platformId });
        }
        return await qb.getRawMany<FirstSteamObservation>();
    }

    public async save(playtime: CreateUserPlaytimeDto, observedAt: Date) {
        await this.playtimeHistoryRepository.insert({
            ...playtime,
            id: undefined,
            createdAt: observedAt,
        });
    }
}
