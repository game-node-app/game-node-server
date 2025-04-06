import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { Repository } from "typeorm";
import { CreateUserPlaytimeDto } from "./dto/create-user-playtime.dto";

@Injectable()
export class PlaytimeHistoryService {
    constructor(
        @InjectRepository(UserPlaytimeHistory)
        private readonly playtimeHistoryRepository: Repository<UserPlaytimeHistory>,
    ) {}

    public async save(playtime: CreateUserPlaytimeDto) {
        await this.playtimeHistoryRepository.insert({
            ...playtime,
            id: undefined,
        });
    }

    public async getRecentPlaytimeSincePeriod(
        userId: string,
        externalGameId: number,
        startDate: Date,
    ) {
        const qb = this.playtimeHistoryRepository.createQueryBuilder("ph");

        const recentPlaytimeSeconds = await qb
            .select(
                "MAX(ph.totalPlaytimeSeconds) - MIN(ph.totalPlaytimeSeconds) AS RECENT_PLAYTIME_SECONDS",
            )
            .where(
                "profileUserId = :profileUserId AND externalGameId = :externalGameId AND lastPlayedDate >= :startDate",
                {
                    profileUserId: userId,
                    externalGameId,
                    startDate,
                },
            )
            .getRawOne<{
                RECENT_PLAYTIME_SECONDS: number;
            }>();

        return recentPlaytimeSeconds?.RECENT_PLAYTIME_SECONDS ?? 0;
    }
}
