import { Type } from "class-transformer";
import { IsDate, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class CreateUpdateAwardsEventDto {
    @IsOptional()
    @IsNumber()
    eventId?: number;
    @IsNotEmpty()
    @IsNumber()
    year: number;
    @IsNotEmpty()
    @Type(() => Date)
    @IsDate()
    votingStartDate: Date;
    @IsNotEmpty()
    @Type(() => Date)
    @IsDate()
    votingEndDate: Date;
    @IsNotEmpty()
    @Type(() => Date)
    @IsDate()
    resultsDate: Date;
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    nominationStartDate?: Date | null;
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    nominationEndDate?: Date | null;
    @IsOptional()
    @Type(() => Date)
    @IsDate()
    eligibilityCutoffDate?: Date | null;
}
