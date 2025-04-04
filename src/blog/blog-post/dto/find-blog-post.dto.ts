import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { BlogPost } from "../entity/blog-post.entity";
import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";

export class FindAllBlogPostRequestDto extends PickType(BaseFindDto<BlogPost>, [
    "limit",
    "offset",
]) {
    tag?: string;
}

export class FindAllBlogPostResponseDto extends PaginationResponseDto {
    declare data: BlogPost[];
}
