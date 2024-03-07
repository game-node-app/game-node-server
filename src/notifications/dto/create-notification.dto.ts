import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications.constants";

export class CreateNotificationDto {
    userId: string;
    targetUserId: string;
    category: ENotificationCategory;
    sourceType: ENotificationSourceType;
    sourceId: string | number;
}
