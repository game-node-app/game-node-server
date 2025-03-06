import { ActivityComment } from "../entity/activity-comment.entity";
import { ReviewComment } from "../entity/review-comment.entity";
import { PostComment } from "../entity/post-comment.entity";
import { OmitType } from "@nestjs/swagger";

export class ActivityCommentDto extends OmitType(ActivityComment, [
    "activity",
    "profile",
    "parentOf",
    "childOf",
]) {
    parentOf: ActivityCommentDto[] | null;
}

export class ReviewCommentDto extends OmitType(ReviewComment, [
    "review",
    "profile",
    "parentOf",
    "childOf",
]) {
    parentOf: ReviewCommentDto[] | null;
}

export class PostCommentDto extends OmitType(PostComment, [
    "post",
    "profile",
    "parentOf",
    "childOf",
]) {
    parentOf: PostCommentDto[] | null;
}

export type AnyCommentDto =
    | ActivityCommentDto
    | ReviewCommentDto
    | PostCommentDto;
