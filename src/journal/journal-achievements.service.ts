import { GameAchievementService } from "../game/game-achievement/game-achievement.service";
import { GameAchievementObtainedService } from "../game/game-achievement/game-achievement-obtained.service";
import {
    GetObtainedAchievementsJournalResponseDto,
    JournalAchievementsGameGroup,
    JournalAchievementsMonthGroup,
    JournalAchievementsYearGroup,
} from "./dto/get-obtained-achievements-journal.dto";
import { Injectable, Logger } from "@nestjs/common";
import { GameAchievementDto } from "../game/game-achievement/dto/game-achievement.dto";
import {
    GameAchievementWithObtainedInfo,
    GameObtainedAchievementDto,
} from "../game/game-achievement/dto/game-obtained-achievement.dto";

@Injectable()
export class JournalAchievementsService {
    private readonly logger = new Logger(JournalAchievementsService.name);

    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly gameObtainedAchievementService: GameAchievementObtainedService,
    ) {}

    public async buildObtainedAchievementsJournal(
        userId: string,
    ): Promise<GetObtainedAchievementsJournalResponseDto> {
        const [obtainedAchievements] =
            await this.gameObtainedAchievementService.findAllObtainedByUserId(
                userId,
                {
                    limit: 999999,
                },
            );

        const uniqueGameIds = Array.from(
            new Set(obtainedAchievements.map((a) => a.gameId)),
        );

        const achievementsByGameId = new Map<number, GameAchievementDto[]>();
        for (const gameId of uniqueGameIds) {
            const achievementGroups =
                await this.gameAchievementService.findAllByGameId(gameId);
            const achievements = achievementGroups.flatMap(
                (group) => group.achievements,
            );

            achievementsByGameId.set(gameId, achievements);
        }

        /**
         * Entries grouped by year, then by month, then by gameId.
         */
        const journalGroupsMap = new Map<
            number,
            Map<number, Map<number, GameObtainedAchievementDto[]>>
        >();

        for (const obtainedAchievement of obtainedAchievements) {
            const obtainmentDate = obtainedAchievement.obtainedAt!;
            const year = obtainmentDate.getFullYear();
            const month = obtainmentDate.getMonth();
            const gameId = obtainedAchievement.gameId;

            if (!journalGroupsMap.has(year)) {
                journalGroupsMap.set(year, new Map());
            }
            const yearGroup = journalGroupsMap.get(year)!;

            if (!yearGroup.has(month)) {
                yearGroup.set(month, new Map());
            }
            const monthGroup = yearGroup.get(month)!;

            if (!monthGroup.has(gameId)) {
                monthGroup.set(gameId, []);
            }

            const gameAchievements = monthGroup.get(gameId)!;

            gameAchievements.push(obtainedAchievement);
        }

        const yearGroups: JournalAchievementsYearGroup[] = [];
        for (const [year, monthGroupsMap] of journalGroupsMap.entries()) {
            const monthGroups: JournalAchievementsMonthGroup[] = [];

            for (const [month, gameGroupsMap] of monthGroupsMap.entries()) {
                const gameGroups: JournalAchievementsGameGroup[] = [];

                for (const [
                    gameId,
                    obtainedAchievements,
                ] of gameGroupsMap.entries()) {
                    const gameAchievements =
                        achievementsByGameId.get(gameId) ?? [];
                    if (gameAchievements.length === 0) {
                        this.logger.warn(
                            `No achievements found for gameId ${gameId}`,
                        );
                        continue;
                    }

                    const obtainedAchievementDtos: GameAchievementWithObtainedInfo[] =
                        obtainedAchievements.map((obtained) => {
                            const relatedAchievement = gameAchievements.find(
                                (a) =>
                                    a.externalGameId ===
                                        obtained.externalGameId &&
                                    a.externalId === obtained.externalId,
                            )!;

                            return {
                                ...relatedAchievement,
                                isObtained: true,
                                obtainedAt: obtained.obtainedAt!,
                            };
                        });

                    gameGroups.push({
                        gameId,
                        achievements: obtainedAchievementDtos,
                    });
                }

                monthGroups.push({
                    month,
                    games: gameGroups,
                });
            }

            const totalObtainedInYear = monthGroups.reduce(
                (acc, monthGroup) => {
                    const monthTotal = monthGroup.games.reduce(
                        (gameAcc, gameGroup) => {
                            return gameAcc + gameGroup.achievements.length;
                        },
                        0,
                    );

                    return acc + monthTotal;
                },
                0,
            );

            yearGroups.push({
                year,
                months: monthGroups,
                totalObtained: totalObtainedInYear,
            });
        }

        return {
            years: yearGroups.sort((a, b) => b.year - a.year),
        };
    }
}
