import { IsArray, IsBoolean, IsNotEmpty, Min } from "class-validator";

export class NotificationViewUpdateDto {
    @IsNotEmpty()
    @IsBoolean()
    isViewed: boolean;
    @IsArray()
    @Min(1)
    @IsNotEmpty()
    notificationIds: number[];
}
