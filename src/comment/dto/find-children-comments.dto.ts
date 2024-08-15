import { OmitType } from "@nestjs/swagger";
import { FindAllCommentsDto } from "./find-all-comments.dto";
import { IsNotEmpty, IsString, Length } from "class-validator";

export class FindChildrenCommentsDto extends OmitType(FindAllCommentsDto, [
    "sourceId",
]) {
    @IsNotEmpty()
    @IsString()
    @Length(36)
    commentId: string;
}
