import { CollectionEntry } from "../entities/collection-entry.entity";
import { CollectionEntryStatus } from "../collections-entries.constants";

export function getAssociatedStatusDates(entry: CollectionEntry) {
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
