import { GameAchievementService } from "../game/game-achievement/game-achievement.service";
import { GameObtainedAchievementService } from "../game/game-achievement/game-obtained-achievement.service";
import {
    GetObtainedAchievementsJournalResponseDto,
    JournalAchievementsGameGroup,
    JournalAchievementsMonthGroup,
    JournalAchievementsYearGroup,
} from "./dto/get-obtained-achievements-journal.dto";
import {
    Injectable,
    Logger,
    ServiceUnavailableException,
} from "@nestjs/common";
import { GameAchievementDto } from "../game/game-achievement/dto/game-achievement.dto";
import {
    GameAchievementWithObtainedInfo,
    GameObtainedAchievementDto,
} from "../game/game-achievement/dto/game-obtained-achievement.dto";
import {
    getIconNameForExternalGameCategory,
    getStoreAbbreviatedNameForExternalGameCategory,
    getStoreNameForExternalGameCategory,
} from "../game/external-game/external-game.utils";
import {
    checkIfGameIsComplete,
    checkIfGameIsPlatinum,
} from "../game/game-achievement/game-achievement.utils";
import { Cacheable } from "../utils/cacheable";
import {
    limiterRedis,
    releaseSlot,
    waitForSlot,
} from "../utils/redis-semaphore";
import { minutes } from "@nestjs/throttler";

const FAN_OUT_BATCH_SIZE = 5;
/** Cold builds query every game's store; a crawl of many profiles shares these few slots instead of the DB pool. */
const MAX_CONCURRENT_BUILDS = 4;
/** Redis key of the build slots, shared by every API process. */
export const JOURNAL_BUILDS_KEY = "journal-achievements:builds";
/** A build holding its slot longer than this is presumed dead (its process exited) and the slot freed. */
const BUILD_STALE_MS = minutes(5);

@Injectable()
export class JournalAchievementsService {
    private readonly logger = new Logger(JournalAchievementsService.name);

    constructor(
        private readonly gameAchievementService: GameAchievementService,
        private readonly gameObtainedAchievementService: GameObtainedAchievementService,
    ) {}

    @Cacheable(JournalAchievementsService.name, minutes(10))
    public async buildObtainedAchievementsJournal(
        userId: string,
    ): Promise<GetObtainedAchievementsJournalResponseDto> {
        const redis = limiterRedis();
        const slot = await waitForSlot(
            redis,
            JOURNAL_BUILDS_KEY,
            MAX_CONCURRENT_BUILDS,
            BUILD_STALE_MS,
            { timeoutMs: minutes(1), pollMs: 250 },
        );
        if (!slot)
            throw new ServiceUnavailableException(
                "Too many journals are being built right now, try again shortly.",
            );
        try {
            return await this.build(userId);
        } finally {
            await releaseSlot(redis, JOURNAL_BUILDS_KEY, slot);
        }
    }

    private async build(
        userId: string,
    ): Promise<GetObtainedAchievementsJournalResponseDto> {
        const [userObtainedAchievements] =
            await this.gameObtainedAchievementService.findAllObtainedByUserId(
                userId,
                {
                    limit: 999999,
                },
            );

        const obtainedByExternalGameId = Map.groupBy(
            userObtainedAchievements,
            (a) => a.externalGameId,
        );

        const achievementsPerExternalGameId = new Map<
            number,
            GameAchievementDto[]
        >();

        // Batched so one user with hundreds of games can't take the whole DB pool.
        const externalGameIds = [...obtainedByExternalGameId.keys()];
        const achievementsPerGameResults: PromiseSettledResult<
            GameAchievementDto[]
        >[] = [];
        for (let i = 0; i < externalGameIds.length; i += FAN_OUT_BATCH_SIZE) {
            achievementsPerGameResults.push(
                ...(await Promise.allSettled(
                    externalGameIds
                        .slice(i, i + FAN_OUT_BATCH_SIZE)
                        .map((externalGameId) =>
                            this.gameAchievementService.findAllByExternalGameId(
                                externalGameId,
                            ),
                        ),
                )),
            );
        }

        for (const result of achievementsPerGameResults) {
            if (result.status === "fulfilled") {
                const achievements = result.value;
                if (achievements.length === 0) continue;

                const externalGameId = achievements[0].externalGameId;

                achievementsPerExternalGameId.set(externalGameId, achievements);
            }
        }

        /**
         * Entries grouped by year, then by month, then by externalGameId.
         */
        const journalGroupsMap = new Map<
            number,
            Map<number, Map<number, GameObtainedAchievementDto[]>>
        >();

        for (const obtainedAchievement of userObtainedAchievements) {
            const obtainmentDate = obtainedAchievement.obtainedAt!;
            const year = obtainmentDate.getFullYear();
            const month = obtainmentDate.getMonth();
            const externalGameId = obtainedAchievement.externalGameId;

            if (!journalGroupsMap.has(year)) {
                journalGroupsMap.set(year, new Map());
            }
            const yearGroup = journalGroupsMap.get(year)!;

            if (!yearGroup.has(month)) {
                yearGroup.set(month, new Map());
            }
            const monthGroup = yearGroup.get(month)!;

            if (!monthGroup.has(externalGameId)) {
                monthGroup.set(externalGameId, []);
            }

            const gameAchievements = monthGroup.get(externalGameId)!;

            gameAchievements.push(obtainedAchievement);
        }

        const yearGroups: JournalAchievementsYearGroup[] = [];
        for (const [year, monthGroupsMap] of journalGroupsMap.entries()) {
            const monthGroups: JournalAchievementsMonthGroup[] = [];

            for (const [month, gameGroupsMap] of monthGroupsMap.entries()) {
                const gameGroups: JournalAchievementsGameGroup[] = [];

                for (const [
                    externalGameId,
                    obtainedAchievements,
                ] of gameGroupsMap.entries()) {
                    const gameAchievements =
                        achievementsPerExternalGameId.get(externalGameId) ?? [];
                    if (gameAchievements.length === 0) {
                        this.logger.warn(
                            `No achievements found for gameId ${externalGameId}`,
                        );
                        continue;
                    }

                    const isComplete = checkIfGameIsComplete(
                        gameAchievements,
                        obtainedByExternalGameId.get(externalGameId)!,
                    );
                    const isPlatinum = checkIfGameIsPlatinum(
                        gameAchievements,
                        obtainedByExternalGameId.get(externalGameId)!,
                    );

                    const allObtainedWithInfoForGame: GameAchievementWithObtainedInfo[] =
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

                    if (allObtainedWithInfoForGame.length === 0) continue;

                    const source = allObtainedWithInfoForGame[0].source;
                    const gameId = allObtainedWithInfoForGame[0].gameId;

                    gameGroups.push({
                        gameId: gameId,
                        externalGameId: externalGameId,
                        isComplete,
                        isPlatinum,
                        source,
                        sourceName:
                            getStoreNameForExternalGameCategory(source)!,
                        sourceAbbreviatedName:
                            getStoreAbbreviatedNameForExternalGameCategory(
                                source,
                            )!,
                        sourceIcon: getIconNameForExternalGameCategory(source)!,
                        achievements: allObtainedWithInfoForGame,
                    });
                }

                if (gameGroups.length === 0) continue;

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

            if (monthGroups.length === 0) continue;

            yearGroups.push({
                year,
                months: monthGroups,
                totalObtained: totalObtainedInYear,
            });
        }

        return {
            years: yearGroups,
        };
    }
}
