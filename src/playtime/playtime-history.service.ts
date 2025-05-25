import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Between, Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";
import { UserPlaytimeSource } from "./playtime.constants";
import dayjs from "dayjs";

@Injectable()
export class PlaytimeHistoryService {
    constructor(
        @InjectRepository(UserPlaytimeHistory)
        private readonly playtimeHistoryRepository: Repository<UserPlaytimeHistory>,
    ) {}

    public async save(playtime: CreateUserPlaytimeDto) {
        const dayStart = dayjs().startOf("day");
        const dayEnd = dayStart.endOf("day");

        const existsInDay = await this.playtimeHistoryRepository.existsBy({
            profileUserId: playtime.profileUserId,
            source: playtime.source,
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
        gameId: number | undefined,
        source: UserPlaytimeSource,
        startDate: Date,
    ) {
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");

        const recentPlaytimeSeconds = await qb
            .select(
                "MAX(ph.totalPlaytimeSeconds) - MIN(ph.totalPlaytimeSeconds) AS RECENT_PLAYTIME_SECONDS",
            )
            .where(
                "ph.profileUserId = :profileUserId AND ph.gameId = :gameId AND ph.source = :source AND ph.lastPlayedDate >= :startDate",
                {
                    profileUserId: userId,
                    gameId,
                    source,
                    startDate,
                },
            )
            .getRawOne<{
                RECENT_PLAYTIME_SECONDS: number;
            }>();

        return recentPlaytimeSeconds?.RECENT_PLAYTIME_SECONDS ?? 0;
    }
}
