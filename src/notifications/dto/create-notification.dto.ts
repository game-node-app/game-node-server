import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications.constants";

export class CreateNotificationDto {
    /**
     * User responsible for action (e.g. user that liked a review)
     */
    userId: string | undefined;
    /**
     * User owner of the target entity (e.g. user that made a review)
     */
    targetUserId: string;
    category: ENotificationCategory;
    sourceType: ENotificationSourceType;
    sourceId: string | number;
}
