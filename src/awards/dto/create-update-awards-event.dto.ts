import { IsDate, IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class CreateUpdateAwardsEventDto {
    @IsOptional()
    @IsNumber()
    eventId?: number;
    @IsNotEmpty()
    @IsNumber()
    year: number;
    @IsNotEmpty()
    @IsDate()
    votingStartDate: Date;
    @IsNotEmpty()
    @IsDate()
    votingEndDate: Date;
    @IsNotEmpty()
    @IsDate()
    resultsDate: Date;
}
