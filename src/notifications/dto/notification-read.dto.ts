import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsInt,
    Min,
    ValidateNested,
} from "class-validator";

export class NotificationReadItemDto {
    @ApiProperty({ description: "Inbox item ID" })
    @IsInt()
    @Min(1)
    id: number;

    @ApiProperty({ description: "Observed item version" })
    @IsInt()
    @Min(1)
    version: number;
}

export class NotificationReadRequestDto {
    @ApiProperty({
        type: [NotificationReadItemDto],
        description: "Items to acknowledge as read (up to 100)",
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => NotificationReadItemDto)
    items: NotificationReadItemDto[];
}
