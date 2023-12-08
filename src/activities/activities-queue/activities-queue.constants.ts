import { PickType } from "@nestjs/swagger";
import { Activity } from "../activities-repository/entities/activity.entity";

export enum ActivityType {
    REVIEW = "REVIEW",
    // TODO: Implement this
    FOLLOW = "FOLLOW",
    COLLECTION_ENTRY = "COLLECTION_ENTRY",
}

export class ActivityCreate extends PickType(Activity, [
    "sourceId",
    "type",
    "profileUserId",
    "metadata",
]) {}
