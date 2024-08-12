import { UserComment } from "./entity/user-comment.entity";

/**
 * Used by comments that can be commented on, essentially creating a thread. <br>
 * All properties must be overridden with actual relationships.
 */
export interface ThreadEnabledComment<T extends UserComment> {
    childOf: T | null;
    childOfId: string | null;
}
