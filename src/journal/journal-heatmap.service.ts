import { Injectable } from "@nestjs/common";
import {
    GetJournalHeatmapResponseDto,
    JournalHeatmapItem,
} from "./dto/get-journal-heatmap.dto";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import dayjs from "dayjs";
import { JournalService } from "./journal.service";

interface PlaytimeDiff {
    date: Date;
    totalPlaytimeSeconds: number;
}

@Injectable()
export class JournalHeatmapService {
    constructor(private readonly journalService: JournalService) {}

    /**
     * Build a heatmap from Journal entry items.
     * @param userId
     */
    public async buildHeatmap(
        userId: string | undefined,
        targetUserId: string,
    ): Promise<GetJournalHeatmapResponseDto> {
        const journalOverview = await this.journalService.getOverview(
            userId,
            targetUserId,
        );

        const heatmapItems: JournalHeatmapItem[] = [];

        /**
         * The good code is the friends we made along the way
         */
        for (const yearGroup of journalOverview.years) {
            const year = yearGroup.year;
            for (const monthGroup of yearGroup.months) {
                const month = monthGroup.month;
                for (const dayGroup of monthGroup.days) {
                    const day = dayGroup.day;
                    /**
                     * @see https://mantine.dev/charts/heatmap/#data-format
                     */
                    const formattedDate = dayjs(
                        `${year}-${month}-${day}`,
                        // Automatically prefixes the fields with 0 when necessary (e.g. MM -> 08)
                    ).format("YYYY-MM-DD");
                    heatmapItems.push({
                        date: formattedDate,
                        count: dayGroup.entries.length,
                    });
                }
            }
        }

        return {
            items: heatmapItems,
        };
    }
}
