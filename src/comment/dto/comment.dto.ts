import { ActivityComment } from "../entity/activity-comment.entity";
import { ReviewComment } from "../entity/review-comment.entity";
import { PostComment } from "../entity/post-comment.entity";

export class ActivityCommentDto extends ActivityComment {}

export class ReviewCommentDto extends ReviewComment {}

export class PostCommentDto extends PostComment {}

export type AnyCommentDto =
    | ActivityCommentDto
    | ReviewCommentDto
    | PostCommentDto;
