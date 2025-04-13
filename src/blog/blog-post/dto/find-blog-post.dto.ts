import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { BlogPost } from "../entity/blog-post.entity";
import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";
import { IsOptional, IsString } from "class-validator";
import { ToBoolean } from "../../../utils/toBoolean";

export class FindAllBlogPostRequestDto extends PickType(BaseFindDto<BlogPost>, [
    "limit",
    "offset",
]) {
    @IsOptional()
    @IsString()
    tag?: string;
    @IsOptional()
    @ToBoolean()
    includeDraft?: boolean = false;
}

export class FindAllBlogPostResponseDto extends PaginationResponseDto {
    declare data: BlogPost[];
}
