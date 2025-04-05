import { PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { BlogPost } from "../entity/blog-post.entity";
import { PaginationResponseDto } from "../../../utils/pagination/pagination-response.dto";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class FindAllBlogPostRequestDto extends PickType(BaseFindDto<BlogPost>, [
    "limit",
    "offset",
]) {
    @IsOptional()
    @IsString()
    tag?: string;
    @IsOptional()
    @IsBoolean()
    includeDraft: boolean = false;
}

export class FindAllBlogPostResponseDto extends PaginationResponseDto {
    declare data: BlogPost[];
}
