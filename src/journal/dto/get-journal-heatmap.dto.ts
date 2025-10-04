export class JournalHeatmapItem {
    /**
     * Date normalized to the 'day' level. In the 'YYYY-MM-DD' format.
     * @see https://mantine.dev/charts/heatmap/#data-format
     */
    date: string;
    count: number;
}

export class GetJournalHeatmapResponseDto {
    items: JournalHeatmapItem[];
}
