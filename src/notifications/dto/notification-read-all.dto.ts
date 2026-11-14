import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional } from "class-validator";

export class NotificationReadAllRequestDto {
    @ApiPropertyOptional({
        description:
            "Mark as read only items whose last event happened at or before this ISO 8601 timestamp (defaults to now)",
        format: "date-time",
    })
    @IsOptional()
    @IsISO8601()
    before?: string;
}

export class NotificationReadAllResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiProperty({
        description: "Unread notifications remaining after the operation",
    })
    unreadCount: number;
}
