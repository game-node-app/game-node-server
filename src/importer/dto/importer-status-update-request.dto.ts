import { ApiProperty } from "@nestjs/swagger";
import { IsNumber } from "class-validator";

export class ImporterStatusUpdateRequestDto {
    @IsNumber()
    externalGameId: number;
    @ApiProperty({
        type: "string",
    })
    status: "ignored" | "processed";
}
