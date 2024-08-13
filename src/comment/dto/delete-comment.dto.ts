import { OmitType, PickType } from "@nestjs/swagger";
import { CreateCommentDto } from "./create-comment.dto";

export class DeleteCommentDto extends PickType(CreateCommentDto, [
    "sourceType",
]) {}
