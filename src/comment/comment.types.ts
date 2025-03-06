import { UserComment } from "./entity/user-comment.entity";
import { ReviewComment } from "./entity/review-comment.entity";
import { ActivityComment } from "./entity/activity-comment.entity";
import { PostComment } from "./entity/post-comment.entity";

/**
 * Used by comments that can be commented on, essentially creating a thread. <br>
 * All properties must be overridden with actual relationships.
 * Only one level of "children" is allowed for performance reasons.
 */
export interface ThreadEnabledComment<T extends UserComment> {
    childOf: T[] | null;
    childOfId: string | null;
}

export type AnyComment = ReviewComment | ActivityComment | PostComment;
