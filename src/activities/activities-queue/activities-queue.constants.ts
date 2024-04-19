export enum ActivityType {
    REVIEW = "REVIEW",
    FOLLOW = "FOLLOW",
    COLLECTION_ENTRY = "COLLECTION_ENTRY",
}

export class ActivityCreate {
    type: ActivityType;
    sourceId: string | number;
    /**
     * Extra sourceId that may be necessary to persist an activity
     * e.g. related collection id when inserting a collection entry activity
     */
    complementarySourceId?: string | number;
    profileUserId: string;
}
