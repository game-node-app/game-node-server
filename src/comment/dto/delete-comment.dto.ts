import { OmitType } from "@nestjs/swagger";
import { CreateCommentDto } from "./create-comment.dto";

export class DeleteCommentDto extends OmitType(CreateCommentDto, [
    "content",
    "sourceId",
    "childOf",
]) {}
