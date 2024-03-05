import { IsBoolean, IsNotEmpty } from "class-validator";

export class NotificationViewUpdateDto {
    @IsNotEmpty()
    @IsBoolean()
    isViewed: boolean;
}
