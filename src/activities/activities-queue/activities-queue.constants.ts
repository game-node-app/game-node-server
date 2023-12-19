import { PickType } from "@nestjs/swagger";
import { Activity } from "../activities-repository/entities/activity.entity";

export enum ActivityType {
    REVIEW = "REVIEW",
    // TODO: Implement this
    FOLLOW = "FOLLOW",
    COLLECTION_ENTRY = "COLLECTION_ENTRY",
}

export enum ActivityCriteria {
    RECENCY,
    POPULARITY,
    FOLLOWING,
}

export class ActivityCreate {
    type: ActivityType;
    sourceId: string;
    profileUserId: string;
    metadata: object | null;
}
