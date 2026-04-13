import { ToBoolean } from "../../../utils/toBoolean";
import { IsDate, IsOptional } from "class-validator";

export class FindGameCompletionStatusDto {
    /**
     * Returns only completed games if true, otherwise returns all games regardless of completion status.
     */
    @IsOptional()
    @ToBoolean()
    onlyCompleted?: boolean = false;
    @IsOptional()
    @IsDate()
    completedPeriodStart?: Date;
    @IsOptional()
    @IsDate()
    completedPeriodEnd?: Date;
}
