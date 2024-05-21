import { IsEnum, IsNotEmpty, IsString, Length } from "class-validator";
import { CommentSourceType } from "../comment.constants";
import { OmitType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { UserComment } from "../entity/user-comment.entity";

export class FindAllCommentsDto extends OmitType(BaseFindDto<UserComment>, [
    "search",
]) {
    @IsNotEmpty()
    @IsString()
    @Length(36)
    sourceId: string;
    @IsNotEmpty()
    @IsEnum(CommentSourceType)
    sourceType: CommentSourceType;
}
