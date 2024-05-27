import { CommentSourceType } from "../comment.constants";
import {
    IsEnum,
    IsNotEmpty,
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
}
