import { Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import {
    JournalEntryStatusDto,
    JournalOverviewResponseDto,
} from "./dto/get-journal-overview.dto";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "src/collections/collections-entries/collections-entries.constants";
import {
    JournalPlaylogEntryDto,
    JournalPlaylogGroupDto,
} from "./dto/get-journal-playlog.dto";
import { JournalPlaylogItemType } from "./journal.constants";
import { GameAchievementService } from "../game/game-achievement/game-achievement.service";
import dayjs from "dayjs";
import { GameAchievementWithObtainedInfo } from "../game/game-achievement/dto/game-obtained-achievement.dto";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";

function getAssociatedDates(entry: CollectionEntry) {
    const dateStatusPairs: { date: Date; status: CollectionEntryStatus }[] = [];

    if (entry.startedAt) {
        dateStatusPairs.push({
            date: entry.startedAt,
            status: CollectionEntryStatus.PLAYING,
        });
    }
    if (entry.finishedAt) {
        dateStatusPairs.push({
            date: entry.finishedAt,
            status: CollectionEntryStatus.FINISHED,
        });
    }
    if (entry.droppedAt) {
        dateStatusPairs.push({
            date: entry.droppedAt,
            status: CollectionEntryStatus.DROPPED,
        });
    }
    if (entry.plannedAt) {
        dateStatusPairs.push({
            date: entry.plannedAt,
            status: CollectionEntryStatus.PLANNED,
        });
    }

    return dateStatusPairs;
}

@Injectable()
export class JournalService {
    constructor(
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly gameAchievementsService: GameAchievementService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    async getOverview(
        userId: string | undefined,
        targetUserId: string,
    ): Promise<JournalOverviewResponseDto> {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                targetUserId,
                {
                    orderBy: {
                        addedDate: "DESC",
                    },
                    limit: 9999999,
                },
            );

        const orderedCollectionEntries = collectionEntries.toSorted((a, b) => {
            const associatedDatesA = getAssociatedDates(a).map((x) => x.date);
            const associatedDatesB = getAssociatedDates(b).map((x) => x.date);

            const latestDateA = associatedDatesA.length
                ? Math.max(...associatedDatesA.map((date) => date.getTime()))
                : -Infinity;
            const latestDateB = associatedDatesB.length
                ? Math.max(...associatedDatesB.map((date) => date.getTime()))
                : -Infinity;

            return latestDateB - latestDateA;
        });

        /**
         * Year -> Month -> Day groups
         */
        const groups = new Map<
            number,
            Map<number, Map<number, JournalEntryStatusDto[]>>
        >();

        for (const collectionEntry of orderedCollectionEntries) {
            const associatedDates = getAssociatedDates(collectionEntry);
            for (const { date, status } of associatedDates) {
                const year = date.getFullYear();
                const month = date.getMonth();
                const day = date.getDate();

                if (!groups.has(year)) {
                    groups.set(year, new Map());
                }

                if (!groups.get(year)?.has(month)) {
                    groups.get(year)?.set(month, new Map());
                }

                if (!groups.get(year)?.get(month)?.has(day)) {
                    groups.get(year)?.get(month)?.set(day, []);
                }

                groups.get(year)?.get(month)?.get(day)?.push({
                    collectionEntryId: collectionEntry.id,
                    status: status,
                    gameId: collectionEntry.gameId,
                });
            }
        }

        return {
            years: Array.from(groups.entries()).map(([year, monthMaps]) => {
                const entriesInMonths = Array.from(monthMaps).map(
                    ([month, dayMaps]) => {
                        const entriesInDays = Array.from(dayMaps).map(
                            ([day, entries]) => {
                                return {
                                    day,
                                    entries,
                                };
                            },
                        );

                        return {
                            month,
                            days: entriesInDays,
                        };
                    },
                );

                return {
                    year,
                    months: entriesInMonths,
                };
            }),
        };
    }

    async getPlaylog(
        userId: string,
        gameId: number,
    ): Promise<JournalPlaylogGroupDto[]> {
        const collectionEntry =
            await this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
                userId,
                gameId,
            );

        const associatedDates = getAssociatedDates(collectionEntry);
        const statusRelatedEntries = associatedDates.map(
            ({ date, status }): JournalPlaylogEntryDto => {
                return {
                    date: dayjs(date).format("YYYY-MM-DD"),
                    entryStatus: status,
                    type: JournalPlaylogItemType.COLLECTION_ENTRY_STATUS,
                    // The One Piece is the variables we named at midnight
                    platformIds: collectionEntry.ownedPlatforms.map(
                        (op) => op.id,
                    ),
                    gameId,
                };
            },
        );
        const playlogAchievements = await this.getPlaylogAchievements(
            userId,
            gameId,
        );

        const playlogEntries = statusRelatedEntries.concat(playlogAchievements);

        const groupedEntries = new Map<string, JournalPlaylogEntryDto[]>();

        const groupingKeySeparator = "__";

        for (const entry of playlogEntries) {
            const key = `${entry.date}${groupingKeySeparator}${entry.type}`;

            if (!groupedEntries.has(key)) {
                groupedEntries.set(key, []);
            }

            const targetEntriesReference = groupedEntries.get(key)!;

            targetEntriesReference.push(entry);
        }

        return Array.from(groupedEntries.entries()).map(([key, entries]) => {
            const [date, type] = key.split(groupingKeySeparator);

            const platformIds = entries.at(0)?.platformIds ?? [];

            return {
                date,
                type: type as JournalPlaylogItemType,
                platformIds,
                entries,
            };
        });
    }

    private async getPlaylogAchievements(
        userId: string,
        gameId: number,
    ): Promise<JournalPlaylogEntryDto[]> {
        const [availableAchievementsGroups, obtainedAchievements] =
            await Promise.all([
                this.gameAchievementsService.findAllByGameId(gameId),
                this.gameAchievementsService.findAllObtainedByGameId(
                    userId,
                    gameId,
                ),
            ]);

        const availableAchievements = availableAchievementsGroups.flatMap(
            (group) => group.achievements,
        );

        const extendedObtainedAchievements = availableAchievements
            .map((achievement): GameAchievementWithObtainedInfo => {
                const relatedObtainedAchievement = obtainedAchievements.find(
                    (oa) =>
                        oa.externalGameId === achievement.externalGameId &&
                        oa.externalId === achievement.externalId,
                );

                return {
                    ...achievement,
                    isObtained: relatedObtainedAchievement?.isObtained ?? false,
                    obtainedAt: relatedObtainedAchievement?.obtainedAt ?? null,
                };
            })
            .filter((achievement) => achievement.isObtained);

        return extendedObtainedAchievements.map((achievement) => ({
            date: dayjs(achievement.obtainedAt!).format("YYYY-MM-DD"),
            type: JournalPlaylogItemType.OBTAINED_ACHIEVEMENT,
            obtainedAchievement: achievement,
            platformIds: achievement.platformIds,
            gameId,
        }));
    }
}
