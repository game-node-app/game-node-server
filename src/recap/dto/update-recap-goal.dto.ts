import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

export class UpdateRecapGoalDto {
    @ApiProperty({ minimum: 1, maximum: 999 })
    @IsInt()
    @Min(1)
    @Max(999)
    target: number;
}
