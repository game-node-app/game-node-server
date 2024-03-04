import { ApiProperty } from "@nestjs/swagger";
import { Notification } from "../entity/notification.entity";
import { ENotificationCategory } from "../notifications.constants";

/**
 * Represents multiple aggregated notifications, which share the same source id and category. <br>
 * Generally meant to be grouped in a single notification by the frontend.
 */
export class NotificationAggregateDto {
    @ApiProperty({
        oneOf: [{ type: "string" }, { type: "number" }],
    })
    sourceId: string | number;
    category: ENotificationCategory;
    notifications: Notification[];
}
