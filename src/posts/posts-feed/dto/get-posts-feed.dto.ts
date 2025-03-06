import { IsNotEmpty, IsString } from "class-validator";
import { OmitType } from "@nestjs/swagger";
import { GetPostsRequestDto } from "../../dto/get-posts.dto";

export enum PostsFeedCriteria {
    FOLLOWING = "following",
    ALL = "all",
}

export class GetPostsFeedDto extends OmitType(GetPostsRequestDto, [
    "gameId",
    "profileUserId",
]) {
    @IsString()
    @IsNotEmpty()
    criteria: PostsFeedCriteria;
}
