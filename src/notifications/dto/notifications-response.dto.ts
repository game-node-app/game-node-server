import {
    ApiExtraModels,
    ApiProperty,
    ApiPropertyOptional,
    getSchemaPath,
} from "@nestjs/swagger";
import { NotificationTarget } from "../notifications.types";

export class NotificationGameContextDto {
    @ApiProperty() id: number;
    @ApiProperty({ maxLength: 240 }) name: string;
    @ApiProperty({ nullable: true }) slug: string | null;
}

export class NotificationActivityContentDto {
    @ApiProperty({
        enum: [
            "post",
            "review",
            "collection_entry",
            "collection",
            "follow",
            "achievement",
            "platform_achievement",
        ],
    })
    type: string;
    @ApiProperty() id: string;
}

export class NotificationContentTargetDto {
    @ApiProperty({ enum: ["post", "review"] }) type: "post" | "review";
    @ApiProperty() id: string;
    @ApiPropertyOptional() focusId?: string;
}

export class NotificationActivityTargetDto {
    @ApiProperty({ enum: ["activity"] }) type: "activity";
    @ApiProperty() id: string;
    @ApiPropertyOptional() focusId?: string;
    @ApiProperty() activityType: string;
    @ApiPropertyOptional({ type: NotificationActivityContentDto })
    content?: NotificationActivityContentDto;
    @ApiPropertyOptional({ type: NotificationGameContextDto })
    game?: NotificationGameContextDto;
}

export class NotificationProfileTargetDto {
    @ApiProperty({ enum: ["profile"] }) type: "profile";
    @ApiProperty() id: string;
}

export class NotificationImporterTargetDto {
    @ApiProperty({ enum: ["importer"] }) type: "importer";
    @ApiProperty() id: string;
    @ApiProperty({ enum: ["steam", "psn", "xbox"] }) provider: string;
}

export class NotificationAchievementTargetDto {
    @ApiProperty({ enum: ["achievement"] }) type: "achievement";
    @ApiProperty({ description: "Achievement definition id" }) id: string;
    @ApiProperty() tier: number;
}

export class NotificationTextPreviewDto {
    @ApiProperty({ maxLength: 240 }) text: string;
    @ApiPropertyOptional({ enum: ["alert", "suspension", "ban"] })
    action?: string;
    @ApiPropertyOptional({ maxLength: 240 }) reason?: string;
}

export class NotificationImportGameDto {
    @ApiProperty() id: number;
    @ApiProperty({ maxLength: 100 }) title: string;
}

export class NotificationImportPreviewDto {
    @ApiProperty({ enum: ["steam", "psn", "xbox"] }) provider: string;
    @ApiProperty() gameCount: number;
    @ApiProperty() importedCount: number;
    @ApiProperty() skippedCount: number;
    @ApiProperty() failedCount: number;
    @ApiProperty({ type: [NotificationImportGameDto], maxItems: 3 })
    gameSample: NotificationImportGameDto[];
}

export class NotificationAvatarDto {
    @ApiProperty() id: number;
    @ApiProperty() filename: string;
}

export class NotificationActorDto {
    @ApiProperty()
    userId: string;

    @ApiProperty()
    username: string;

    @ApiProperty({ nullable: true, type: NotificationAvatarDto })
    avatar?: {
        id: number;
        filename: string;
    } | null;
}

@ApiExtraModels(
    NotificationContentTargetDto,
    NotificationActivityTargetDto,
    NotificationProfileTargetDto,
    NotificationImporterTargetDto,
    NotificationAchievementTargetDto,
    NotificationTextPreviewDto,
    NotificationImportPreviewDto,
)
export class NotificationInboxItemDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    type: string;

    @ApiProperty({ type: [NotificationActorDto] })
    actors: NotificationActorDto[];

    @ApiProperty({
        nullable: true,
        oneOf: [NotificationTextPreviewDto, NotificationImportPreviewDto].map(
            (type) => ({ $ref: getSchemaPath(type) }),
        ),
    })
    preview: Record<string, any> | null;

    @ApiProperty({
        nullable: true,
        oneOf: [
            NotificationContentTargetDto,
            NotificationActivityTargetDto,
            NotificationProfileTargetDto,
            NotificationImporterTargetDto,
            NotificationAchievementTargetDto,
        ].map((type) => ({ $ref: getSchemaPath(type) })),
    })
    target: NotificationTarget | null;

    @ApiProperty()
    eventCount: number;

    @ApiProperty()
    actorCount: number;

    @ApiProperty()
    lastEventAt: Date;

    @ApiProperty()
    version: number;

    @ApiProperty()
    readVersion: number;
}

export class NotificationsPaginationDto {
    @ApiProperty({ nullable: true })
    nextCursor: string | null;

    @ApiProperty()
    hasMore: boolean;
}

export class NotificationsResponseDto {
    @ApiProperty({ type: [NotificationInboxItemDto] })
    data: NotificationInboxItemDto[];

    @ApiProperty({ type: NotificationsPaginationDto })
    pagination: NotificationsPaginationDto;

    @ApiProperty()
    unreadCount: number;
}
