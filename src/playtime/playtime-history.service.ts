import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Between, Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import dayjs from "dayjs";
import { UserPlaytimeSource } from "./playtime.constants";
import { GetTotalPlaytimePeriodDto } from "./dto/get-total-playtime-period.dto";

@Injectable()
export class PlaytimeHistoryService {
    constructor(
        @InjectRepository(UserPlaytimeHistory)
        private readonly playtimeHistoryRepository: Repository<UserPlaytimeHistory>,
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
        const { userId, source, platformId, startDate, endDate, criteria } =
            dto;
        const playtimeHistory = await this.findAllByUserId(userId);
        const playtimeInPeriod = playtimeHistory
            .filter(
                (entry) =>
                    entry.lastPlayedDate != undefined &&
                    dayjs(entry.lastPlayedDate).isAfter(startDate) &&
                    dayjs(entry.lastPlayedDate).isBefore(endDate),
            )
            .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        const maxForGamesInPeriodMap = new Map<number, number>();

        for (const playtimeHistory of playtimeInPeriod) {
            const matchesSource = source
                ? playtimeHistory.source === source
                : true;
            const matchesPlatform = platformId
                ? playtimeHistory.platformId === platformId
                : true;

            if (matchesSource && matchesPlatform) {
                const existingMax =
                    maxForGamesInPeriodMap.get(playtimeHistory.gameId) ?? 0;
                const targetValue = playtimeHistory[criteria];

                if (playtimeHistory.totalPlaytimeSeconds > existingMax) {
                    maxForGamesInPeriodMap.set(
                        playtimeHistory.gameId,
                        targetValue,
                    );
                }
            }
        }

        return Array.from(maxForGamesInPeriodMap.values()).reduce(
            (acc, curr) => acc + curr,
            0,
        );
    }

    public async save(playtime: CreateUserPlaytimeDto) {
        const dayStart = dayjs().startOf("day");
        const dayEnd = dayStart.endOf("day");

        const existsInDay = await this.playtimeHistoryRepository.existsBy({
            profileUserId: playtime.profileUserId,
            source: playtime.source,
            platformId: playtime.platformId,
            gameId: playtime.gameId,
            createdAt: Between(dayStart.toDate(), dayEnd.toDate()),
        });

        if (existsInDay) {
            return;
        }

        await this.playtimeHistoryRepository.insert({
            ...playtime,
            id: undefined,
        });
    }

    public async getRecentPlaytimeForGame(
        userId: string,
        gameId: number,
        source: UserPlaytimeSource,
        platformId: number,
        startDate: Date,
    ) {
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");

        const recentPlaytimeSeconds = await qb
            .select(
                "MAX(ph.totalPlaytimeSeconds) - MIN(ph.totalPlaytimeSeconds) AS RECENT_PLAYTIME_SECONDS",
            )
            .where(
                "ph.profileUserId = :profileUserId AND ph.gameId = :gameId AND ph.source = :source AND ph.platformId = :platformId AND ph.lastPlayedDate >= :startDate",
                {
                    profileUserId: userId,
                    gameId,
                    source,
                    platformId,
                    startDate,
                },
            )
            .getRawOne<{
                RECENT_PLAYTIME_SECONDS: number;
            }>();

        return recentPlaytimeSeconds?.RECENT_PLAYTIME_SECONDS ?? 0;
    }
}
