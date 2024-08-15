import { OmitType, PickType } from "@nestjs/swagger";
import { CreateCommentDto } from "./create-comment.dto";

export class UpdateCommentDto extends PickType(CreateCommentDto, [
    "sourceType",
    "content",
]) {}
