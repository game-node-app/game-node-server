import { Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { GameAchievementService } from "../game/game-achievement/game-achievement.service";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import {
    JournalPlaylogEntryDto,
    JournalPlaylogGroupDto,
} from "./dto/get-journal-playlog.dto";
import { getAssociatedStatusDates } from "../collections/collections-entries/util/getAssociatedStatusDates";
import { JournalPlaylogItemType } from "./journal.constants";
import dayjs from "dayjs";
import { GameAchievementWithObtainedInfo } from "../game/game-achievement/dto/game-obtained-achievement.dto";

@Injectable()
export class JournalPlayLogService {
    constructor(
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly gameAchievementsService: GameAchievementService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    async getPlaylog(
        userId: string,
        gameId: number,
    ): Promise<JournalPlaylogGroupDto[]> {
        const collectionEntry =
            await this.collectionsEntriesService.findOneByUserIdAndGameIdOrFail(
                userId,
                gameId,
            );

        const associatedDates = getAssociatedStatusDates(collectionEntry);
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

        return Array.from(groupedEntries.entries())
            .map(([key, entries]) => {
                const [date, type] = key.split(groupingKeySeparator);

                const platformIds = entries.at(0)?.platformIds ?? [];

                return {
                    date,
                    type: type as JournalPlaylogItemType,
                    platformIds,
                    entries,
                };
            })
            .toSorted((a, b) => {
                return dayjs(a.date).valueOf() - dayjs(b.date).valueOf();
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

    private async getPlaylogPlaytimes(userId: string, gameId: number) {}
}
