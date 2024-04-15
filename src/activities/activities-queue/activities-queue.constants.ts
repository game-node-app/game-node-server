export enum ActivityType {
    REVIEW = "REVIEW",
    FOLLOW = "FOLLOW",
    COLLECTION_ENTRY = "COLLECTION_ENTRY",
}

export class ActivityCreate {
    type: ActivityType;
    sourceId: string | number;
    profileUserId: string;
}
