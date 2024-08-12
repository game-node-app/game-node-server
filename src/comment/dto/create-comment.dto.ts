import { CommentSourceType } from "../comment.constants";
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
    MinLength,
} from "class-validator";

export class CreateCommentDto {
    /**
     * UUID of the target entity. Comments can only be attributed to
     * UUID based entities.
     */
    @IsNotEmpty()
    @IsString()
    @Length(36)
    sourceId: string;
    @IsNotEmpty()
    @IsEnum(CommentSourceType)
    sourceType: CommentSourceType;
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    content: string;
    @IsOptional()
    @Length(36)
    childOf?: string;
}
