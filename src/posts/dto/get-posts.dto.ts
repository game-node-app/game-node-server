import { Post } from "../entity/post.entity";
import { CursorPaginationResponseDto } from "../../utils/pagination/pagination-response.dto";
import { BaseCursorFindDto } from "../../utils/base-cursor-find.dto";

export class GetPostsRequestDto extends BaseCursorFindDto {
    postId?: string;
    gameId?: number;
    profileUserId?: string;
}

export class GetPostsPaginatedResponseDto extends CursorPaginationResponseDto {
    declare data: Post[];
}
