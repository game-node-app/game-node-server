import {
    PlayerSyncWrite,
    recordPlayerSyncStats,
} from "../sync/player-sync-attempt";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
    FindManyOptions,
    In,
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
import { currentPlayerSyncObservationAt } from "../sync/player-sync-attempt";
import { Transactional } from "typeorm-transactional";

const persistedDate = (date: Date | null | undefined) =>
    date == null
        ? null
        : new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
const persistedInteger = (value: number | undefined) =>
    Math.round(Number(value ?? 0));

const createChecksum = (
    dto: CreateUserPlaytimeDto,
    includeRecentPlaytime = dto.source === UserPlaytimeSource.STEAM &&
        dto.recentPlaytimeSeconds != null,
) => {
    // PSN/Xbox recent totals are derived from history; only provider-supplied Steam recent time belongs here.
    const relevantData = {
        profileUserId: dto.profileUserId,
        gameId: Number(dto.gameId),
        source: dto.source,
        platformId: Number(dto.platformId),
        totalPlaytimeSeconds: persistedInteger(dto.totalPlaytimeSeconds),
        ...(includeRecentPlaytime
            ? {
                  recentPlaytimeSeconds: persistedInteger(
                      dto.recentPlaytimeSeconds,
                  ),
              }
            : {}),
        lastPlayedDate: persistedDate(dto.lastPlayedDate),
        totalPlayCount: persistedInteger(dto.totalPlayCount),
        firstPlayedDate: persistedDate(dto.firstPlayedDate),
    };

    return generateChecksum(relevantData);
};

@Injectable()
export class PlaytimeService {
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

    public async findForImport(
        userId: string,
        source: UserPlaytimeSource,
        gameIds: number[],
    ) {
        const existing = new Map<string, UserPlaytime>();
        const ids = [...new Set(gameIds)];
        for (let offset = 0; offset < ids.length; offset += 500) {
            const rows = await this.userPlaytimeRepository.findBy({
                profileUserId: userId,
                source,
                gameId: In(ids.slice(offset, offset + 500)),
            });
            for (const row of rows)
                existing.set(`${row.gameId}:${row.platformId}`, row);
        }
        return existing;
    }

    async save(playtime: CreateUserPlaytimeDto) {
        const existing = await this.findOne(
            playtime.profileUserId,
            playtime.gameId,
            playtime.source,
            playtime.platformId,
        );
        const [saved] = await this.saveImported(
            [playtime],
            new Map(
                existing
                    ? [[`${existing.gameId}:${existing.platformId}`, existing]]
                    : [],
            ),
        );
        return saved;
    }

    async saveImported(
        playtimes: CreateUserPlaytimeDto[],
        existing: Map<string, UserPlaytime>,
    ) {
        const result = await this.persistImported(playtimes, existing);
        recordPlayerSyncStats({ gamesChanged: result.changed });
        return result.saved;
    }

    @PlayerSyncWrite()
    @Transactional()
    private async persistImported(
        playtimes: CreateUserPlaytimeDto[],
        existing: Map<string, UserPlaytime>,
    ) {
        if (
            playtimes.some(
                (playtime) =>
                    playtime.profileUserId !== playtimes[0].profileUserId ||
                    playtime.source !== playtimes[0].source,
            )
        )
            throw new Error(
                "Imported playtime must belong to one user and source",
            );
        const observedAt = currentPlayerSyncObservationAt() ?? new Date();
        const window = {
            startDate: dayjs(observedAt).subtract(14, "day").toDate(),
            endDate: observedAt,
        };
        const prepared = [] as {
            playtime: CreateUserPlaytimeDto;
            previous?: UserPlaytime;
            checksum: string;
            changed: boolean;
        }[];
        for (const playtime of new Map(
            playtimes.map((playtime) => [
                `${playtime.gameId}:${playtime.platformId}`,
                playtime,
            ]),
        ).values()) {
            const previous = existing.get(
                `${playtime.gameId}:${playtime.platformId}`,
            );
            if (
                previous &&
                (previous.profileUserId !== playtime.profileUserId ||
                    previous.source !== playtime.source)
            )
                throw new Error("Mismatched imported playtime identity");
            const updated = {
                ...previous,
                ...playtime,
                firstPlayedDate:
                    playtime.firstPlayedDate === undefined
                        ? previous?.firstPlayedDate
                        : playtime.firstPlayedDate,
                lastPlayedDate:
                    playtime.lastPlayedDate === undefined
                        ? previous?.lastPlayedDate
                        : playtime.lastPlayedDate,
                totalPlayCount:
                    playtime.totalPlayCount ?? previous?.totalPlayCount,
                recentPlaytimeSeconds: playtime.recentPlaytimeSeconds,
            };
            const checksum = createChecksum(updated);
            const changed =
                previous == null ||
                createChecksum(
                    previous,
                    playtime.source === UserPlaytimeSource.STEAM &&
                        playtime.recentPlaytimeSeconds != null,
                ) !== checksum;
            if (changed)
                await this.playtimeHistoryService.save(updated, observedAt);
            prepared.push({ playtime: updated, previous, checksum, changed });
        }
        const recentByWindow = new Map<string, Map<number, number>>();
        for (const { playtime } of prepared) {
            if (playtime.recentPlaytimeSeconds != null) continue;
            const key = JSON.stringify([
                playtime.profileUserId,
                playtime.source,
                playtime.platformId,
            ]);
            if (!recentByWindow.has(key)) {
                const totals =
                    await this.playtimeHistoryService.getTotalPlaytimeForPeriod(
                        {
                            userId: playtime.profileUserId,
                            source: playtime.source,
                            platformId: playtime.platformId,
                            ...window,
                        },
                    );
                recentByWindow.set(
                    key,
                    new Map(
                        totals.map((total) => [
                            total.gameId,
                            total.totalPlaytimeInPeriodSeconds,
                        ]),
                    ),
                );
            }
        }
        const saved = [] as UserPlaytime[];
        for (const { playtime, previous, checksum, changed } of prepared) {
            const key = JSON.stringify([
                playtime.profileUserId,
                playtime.source,
                playtime.platformId,
            ]);
            const recentPlaytimeSeconds =
                playtime.recentPlaytimeSeconds ??
                recentByWindow.get(key)!.get(playtime.gameId) ??
                0;
            const age = previous
                ? dayjs(observedAt).diff(dayjs(previous.updatedAt), "day")
                : Infinity;
            if (
                previous &&
                !changed &&
                age < 14 &&
                Number(previous.recentPlaytimeSeconds) ===
                    Number(recentPlaytimeSeconds)
            ) {
                saved.push(previous);
            } else {
                saved.push(
                    await this.userPlaytimeRepository.save({
                        ...playtime,
                        recentPlaytimeSeconds,
                        checksum,
                    }),
                );
            }
        }
        return {
            saved,
            changed: prepared.filter((item) => item.changed).length,
        };
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
