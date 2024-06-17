import { IsArray, IsBoolean, IsNotEmpty, Min } from "class-validator";

export class NotificationViewUpdateDto {
    @IsNotEmpty()
    @IsBoolean()
    isViewed: boolean;
    @IsArray()
    @IsNotEmpty()
    notificationIds: number[];
}
