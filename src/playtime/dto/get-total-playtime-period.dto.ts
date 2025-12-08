import { UserPlaytimeSource } from "../playtime.constants";

export class GetTotalPlaytimePeriodDto {
    userId: string;
    startDate: Date;
    endDate: Date;
    source?: UserPlaytimeSource;
    platformId?: number;
}
