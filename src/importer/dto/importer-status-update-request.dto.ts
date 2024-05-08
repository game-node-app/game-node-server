import { ApiProperty } from "@nestjs/swagger";

export class ImporterStatusUpdateRequestDto {
    externalGameId: number;
    status: "ignored" | "processed";
}
