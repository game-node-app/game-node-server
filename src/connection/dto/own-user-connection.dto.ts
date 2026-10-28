import { ApiPropertyOptional } from "@nestjs/swagger";
import { UserConnectionDto } from "./user-connection.dto";

export class OwnUserConnectionDto extends UserConnectionDto {
    @ApiPropertyOptional({ type: Number })
    unprocessedCount?: number;

    @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
    lastSyncedAt?: string | null;
}
