import { Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import {
    JournalEntriesGroupedDto,
    JournalEntryDetailsDto,
} from "./dto/get-journal-overview.dto";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "src/collections/collections-entries/collections-entries.constants";

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
    ) {}

    async getJournalOverview(
        userId: string | undefined,
        targetUserId: string,
    ): Promise<JournalEntriesGroupedDto> {
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
            Map<number, Map<number, JournalEntryDetailsDto[]>>
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
}
