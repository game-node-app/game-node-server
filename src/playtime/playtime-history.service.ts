import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Repository, SelectQueryBuilder } from "typeorm";
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
 * Spreads `amount` evenly over [from, to] and keeps the part overlapping
 * (startDate, endDate]. Rounding both cumulative edges conserves the total
 * between adjacent windows. An empty or inverted interval puts the whole
 * amount at `to`.
 */
export function spreadPlaytimeSeconds(
    amount: unknown,
    from: Date,
    to: Date,
    startDate: Date,
    endDate: Date,
) {
    const seconds = nonNegativeSeconds(amount);
    const span = to.getTime() - from.getTime();
    if (span <= 0) {
        return startDate.getTime() < to.getTime() &&
            to.getTime() <= endDate.getTime()
            ? seconds
            : 0;
    }
    const cumulative = (date: Date) => {
        const elapsed = Math.min(
            Math.max(date.getTime() - from.getTime(), 0),
            span,
        );
        return Math.round(seconds * (elapsed / span));
    };
    return cumulative(endDate) - cumulative(startDate);
}

type FirstObservation = {
    gameId: number;
    source: UserPlaytimeSource;
    platformId: number;
    observedAt: Date;
    recentPlaytimeSeconds: number;
    totalPlaytimeSeconds: number;
    firstPlayedDate: Date | null;
    lastPlayedDate: Date | null;
    /** Latest earlier sync of the same source; only fetched for Xbox candidates. */
    previousSyncAt: Date | null;
};

/**
 * Time played before a game's first observation, as an amount and the
 * interval it is spread over, or null when it cannot be told apart from
 * lifetime time.
 */
export function firstObservationSpread(observation: FirstObservation) {
    const { source, observedAt, firstPlayedDate, lastPlayedDate } = observation;
    if (source === UserPlaytimeSource.STEAM) {
        // Steam's recent total covers the 14 days before the observation.
        return {
            amount: Math.min(
                nonNegativeSeconds(observation.recentPlaytimeSeconds),
                nonNegativeSeconds(observation.totalPlaytimeSeconds),
            ),
            from: new Date(observedAt.getTime() - STEAM_RECENT_WINDOW_MS),
            to: observedAt,
        };
    }
    const to = new Date(
        Math.min(
            lastPlayedDate?.getTime() ?? observedAt.getTime(),
            observedAt.getTime(),
        ),
    );
    if (firstPlayedDate) {
        return {
            amount: observation.totalPlaytimeSeconds,
            from: firstPlayedDate,
            to,
        };
    }
    const { previousSyncAt } = observation;
    // Xbox: a game new to an already syncing connection was played since the
    // previous sync. The query drops games seen before on another platform.
    if (
        source === UserPlaytimeSource.XBOX &&
        previousSyncAt &&
        (lastPlayedDate == null || lastPlayedDate >= previousSyncAt)
    ) {
        return {
            amount: observation.totalPlaytimeSeconds,
            from: previousSyncAt,
            to,
        };
    }
    // shortcut: Epic/GOG are excluded because a newly mapped old game (e.g. the Epic namespace fill) brings its lifetime total, upgrade when they expose a real last-played date.
    return null;
}

export interface DailyPlaytime {
    day: string;
    gameId: number;
    platformId: number;
    seconds: number;
}

export interface PlaytimePeriodOptions {
    /**
     * Sum only observations with an earlier baseline (`previous IS NOT NULL`),
     * so a first lifetime import from Steam/PSN/Xbox contributes zero.
     */
    excludeInitialObservations?: boolean;
    /** Group daily deltas by America/Sao_Paulo dates instead of UTC ones. */
    saoPauloDays?: boolean;
}

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

    private previousPlaytimeSubQuery(
        qb: SelectQueryBuilder<UserPlaytimeHistory>,
    ) {
        return qb
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
    }

    public async getTotalPlaytimeForPeriod(
        dto: GetTotalPlaytimePeriodDto,
        options: PlaytimePeriodOptions = {},
    ) {
        const { userId, source, platformId, startDate, endDate } = dto;
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");
        const previous = this.previousPlaytimeSubQuery(qb);

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
        if (options.excludeInitialObservations) {
            qb.andWhere(`${previous} IS NOT NULL`);
        }

        const totals = await qb.getRawMany<PlaytimeInPeriod>();
        // First observations are initial lifetime imports, which this mode never counts.
        const estimates = options.excludeInitialObservations
            ? []
            : await this.getFirstObservations(dto);
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
            const spread = firstObservationSpread(estimate);
            if (!spread) continue;
            const seconds = spreadPlaytimeSeconds(
                spread.amount,
                spread.from,
                spread.to,
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

    /**
     * First observations of each (game, source, platform) that may overlap the
     * period; `firstObservationSpread` decides how much of them counts.
     */
    private async getFirstObservations(dto: GetTotalPlaytimePeriodDto) {
        const { userId, source, platformId, startDate, endDate } = dto;
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");
        const previous = qb
            .subQuery()
            .select("previous.totalPlaytimeSeconds")
            .from(UserPlaytimeHistory, "previous")
            .useIndex("IDX_playtime_observation_previous")
            .where("previous.profileUserId = ph.profileUserId")
            .andWhere("previous.gameId = ph.gameId")
            .andWhere("previous.source = ph.source")
            .andWhere("previous.platformId = ph.platformId")
            .andWhere(
                "(previous.createdAt < ph.createdAt OR (previous.createdAt = ph.createdAt AND previous.id < ph.id))",
            )
            .getQuery();
        // Xbox switching a game's preferred platform starts a new key carrying the lifetime total.
        const otherPlatform = qb
            .subQuery()
            .select("otherPlatform.id")
            .from(UserPlaytimeHistory, "otherPlatform")
            .where("otherPlatform.profileUserId = ph.profileUserId")
            .andWhere("otherPlatform.gameId = ph.gameId")
            .andWhere("otherPlatform.source = ph.source")
            .andWhere("otherPlatform.createdAt < ph.createdAt")
            .getQuery();
        // Rows of one import share createdAt, so the initial import has no earlier sync.
        const previousSync = qb
            .subQuery()
            .select("MAX(sync.createdAt)")
            .from(UserPlaytimeHistory, "sync")
            // Bounded by the profile's rows of this source, not its whole history.
            .useIndex("IDX_playtime_observation_window")
            .where("sync.profileUserId = ph.profileUserId")
            .andWhere("sync.source = ph.source")
            .andWhere("sync.createdAt < ph.createdAt")
            .getQuery();
        const xboxCandidate =
            "ph.source = :xbox AND ph.firstPlayedDate IS NULL";

        qb.select("ph.gameId", "gameId")
            .addSelect("ph.source", "source")
            .addSelect("ph.platformId", "platformId")
            .addSelect("ph.createdAt", "observedAt")
            .addSelect("ph.recentPlaytimeSeconds", "recentPlaytimeSeconds")
            .addSelect("ph.totalPlaytimeSeconds", "totalPlaytimeSeconds")
            .addSelect("ph.firstPlayedDate", "firstPlayedDate")
            .addSelect("ph.lastPlayedDate", "lastPlayedDate")
            .addSelect(
                `CASE WHEN ${xboxCandidate} THEN ${previousSync} END`,
                "previousSyncAt",
            )
            .where(`NOT EXISTS ${previous}`)
            .andWhere("ph.profileUserId = :userId", { userId })
            // Every interval ends at or before the observation.
            .andWhere("ph.createdAt > :startDate", { startDate })
            .andWhere(
                `(
                    (ph.source = :steam AND ph.recentPlaytimeSeconds > 0 AND ph.createdAt < :steamEndDate)
                    OR (ph.source <> :steam AND ph.firstPlayedDate IS NOT NULL
                        AND LEAST(ph.firstPlayedDate, COALESCE(ph.lastPlayedDate, ph.createdAt), ph.createdAt) <= :endDate)
                    OR (${xboxCandidate} AND NOT EXISTS ${otherPlatform})
                )`,
                {
                    steam: UserPlaytimeSource.STEAM,
                    xbox: UserPlaytimeSource.XBOX,
                    // A Steam first observation up to one recent window after
                    // the period end can still overlap it.
                    steamEndDate: new Date(
                        endDate.getTime() + STEAM_RECENT_WINDOW_MS,
                    ),
                    endDate,
                },
            );
        if (source) {
            qb.andWhere("ph.source = :source", { source });
        }
        if (platformId) {
            qb.andWhere("ph.platformId = :platformId", { platformId });
        }
        return await qb.getRawMany<FirstObservation>();
    }

    public async getDailyPlaytimeForPeriod(
        userId: string,
        start: Date,
        end: Date,
        options: PlaytimePeriodOptions = {},
    ): Promise<DailyPlaytime[]> {
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");
        const previous = this.previousPlaytimeSubQuery(qb);
        // Fixed UTC-3 offset, matching DAILY_TIME_ZONE's shortcut.
        const dayExpression = options.saoPauloDays
            ? "DATE_FORMAT(CONVERT_TZ(ph.createdAt, '+00:00', '-03:00'), '%Y-%m-%d')"
            : "DATE_FORMAT(ph.createdAt, '%Y-%m-%d')";

        qb.select(dayExpression, "day")
            .addSelect("ph.gameId", "gameId")
            .addSelect("ph.platformId", "platformId")
            .addSelect(
                // Same attribution rule as getTotalPlaytimeForPeriod, split per observed day.
                `COALESCE(SUM(GREATEST(ph.totalPlaytimeSeconds - ${previous}, 0)), 0)`,
                "seconds",
            )
            .groupBy(`${dayExpression}, ph.gameId, ph.platformId`)
            .where("ph.createdAt > :start AND ph.createdAt <= :end", {
                start,
                end,
            })
            .andWhere("ph.profileUserId = :userId", { userId });
        if (options.excludeInitialObservations) {
            qb.andWhere(`${previous} IS NOT NULL`);
        }

        const rows = await qb.getRawMany<DailyPlaytime>();
        // MySQL returns SUM as a decimal string, while callers add numeric seconds.
        return rows.map((row) => ({
            ...row,
            gameId: Number(row.gameId),
            platformId: Number(row.platformId),
            seconds: Number(row.seconds),
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
