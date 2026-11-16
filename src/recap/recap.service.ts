import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { YearRecap } from "./entity/year-recap.entity";
import { In, Repository } from "typeorm";
import { FindOptionsRelations } from "typeorm/find-options/FindOptionsRelations";
import { ProfileService } from "../profile/profile.service";
import { RecapStatusDto } from "./dto/recap-status.dto";
import { minutes } from "@nestjs/throttler";
import { YearRecapDto } from "./dto/year-recap.dto";
import {
    deriveBacklogGrowth,
    deriveCalendarHighlights,
    derivePlaytimeByPlatform,
    deriveTopGames,
    recapCacheId,
    transformRecapDistributions,
    transformRecapPlatforms,
} from "./recap.utils";
import { YearRecapPlatformCountDto } from "./dto/year-recap-platform.dto";
import { RecapWindowService } from "./recap-window.service";

@Injectable()
export class RecapService {
    private readonly relations: FindOptionsRelations<YearRecap> = {
        platforms: {
            platform: true,
        },
        playedGames: {
            platform: true,
        },
        genres: {
            genre: true,
        },
        modes: {
            mode: true,
        },
        themes: {
            theme: true,
        },
    };

    constructor(
        @InjectRepository(YearRecap)
        private readonly recapRepository: Repository<YearRecap>,
        private readonly profileService: ProfileService,
        private readonly recapWindowService: RecapWindowService,
    ) {}

    public async getRecapStatus(
        userId: string,
        targetYear: number,
    ): Promise<RecapStatusDto> {
        const phase = await this.recapWindowService.getRecapPhase(targetYear);
        const profile = await this.profileService.findOneByIdOrFail(userId);
        const isEligible = profile.createdAt.getFullYear() <= targetYear;

        if (!isEligible) {
            return {
                isRecapCreated: false,
                isRecapEligible: false,
                phase,
            };
        }

        const isAvailable = await this.recapRepository.existsBy({
            profileUserId: userId,
            year: targetYear,
        });

        return {
            isRecapCreated: isAvailable,
            isRecapEligible: isEligible,
            phase,
        };
    }

    public async findAllByUserIds(userIds: string[]): Promise<YearRecap[]> {
        return this.recapRepository.find({
            where: {
                profileUserId: In(userIds),
            },
        });
    }

    public async getRecapByUserId(
        userId: string,
        targetYear: number,
    ): Promise<YearRecapDto> {
        const result = (await this.recapRepository.findOneOrFail({
            where: {
                profileUserId: userId,
                year: targetYear,
            },
            relations: this.relations,
            relationLoadStrategy: "query",
            cache: {
                id: recapCacheId(userId, targetYear),
                milliseconds: minutes(15),
            },
        })) as YearRecapDto;

        transformRecapPlatforms(result);
        transformRecapDistributions(result);

        const playedPlatformsCountMap = new Map<
            number,
            YearRecapPlatformCountDto
        >();

        for (const playedGame of result.playedGames) {
            const platform = playedGame.platform;
            const existingCount =
                playedPlatformsCountMap.get(platform.id)?.count || 0;
            playedPlatformsCountMap.set(platform.id, {
                ...platform,
                count: existingCount + 1,
            });
        }

        // Sorted by count descending
        const sortedPlayedPlatformsCountArray = Array.from(
            playedPlatformsCountMap.values(),
        ).toSorted((a, b) => b.count - a.count);

        return {
            ...result,
            playedGamesByPlatform: sortedPlayedPlatformsCountArray,
            backlogGrowth: deriveBacklogGrowth(
                result.totalAddedGames,
                result.totalFinishedGames,
                result.totalDroppedGames,
            ),
            calendar: deriveCalendarHighlights(
                result.dailyPlaytimeSeconds,
                result.year,
            ),
            topGames: deriveTopGames(result.playedGames),
            playtimeByPlatform: derivePlaytimeByPlatform(result.playedGames),
        };
    }
}
