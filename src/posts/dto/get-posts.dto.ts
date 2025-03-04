import { Post } from "../entity/post.entity";
import { CursorPaginationResponseDto } from "../../utils/pagination/pagination-response.dto";
import { BaseCursorFindDto } from "../../utils/base-cursor-find.dto";

export class GetPostsRequestDto extends BaseCursorFindDto {
    gameId?: number;
    profileUserId?: string;
}

export class GetPostsPaginatedReponseDto extends CursorPaginationResponseDto {
    declare data: Post[];
}
