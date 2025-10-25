import { UserPlaytimeSource } from "../playtime.constants";

export class GetTotalPlaytimePeriodDto {
    userId: string;
    criteria: "totalPlaytimeSeconds" | "recentPlaytimeSeconds" =
        "totalPlaytimeSeconds";
    startDate: Date;
    endDate: Date;
    source?: UserPlaytimeSource;
    platformId?: number;
}
