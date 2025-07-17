import { ApiProperty } from "@nestjs/swagger";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";

export class JournalOverviewResponseDto {
    @ApiProperty({ description: "Group of collection entries by year" })
    years: JournalEntryYearGroupDto[];
}

export class JournalEntryYearGroupDto {
    @ApiProperty({ description: "Year of the grouping", example: 2025 })
    year: number;

    @ApiProperty({ description: "Months within the year" })
    months: JournalEntryMonthGroupDto[];
}

export class JournalEntryMonthGroupDto {
    @ApiProperty({ description: "Month of the grouping", example: 7 })
    month: number;

    @ApiProperty({ description: "Days within the month" })
    days: JournalEntryDayGroupDto[];
}

export class JournalEntryDayGroupDto {
    @ApiProperty({ description: "Day of the grouping", example: 12 })
    day: number;

    @ApiProperty({
        description: "List of games and their statuses for the day",
    })
    entries: JournalEntryStatusDto[];
}

export class JournalEntryStatusDto {
    @ApiProperty({
        description: "UUID of the collection entry",
    })
    collectionEntryId: string;
    @ApiProperty({ description: "ID of the game", example: 12345 })
    gameId: number;

    @ApiProperty({
        description: "Status of the game (e.g., Finished, Started, etc.)",
        example: "Finished",
    })
    status: CollectionEntryStatus;
}
