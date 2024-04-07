import { IsNotEmpty, IsString, Length } from "class-validator";
import { ApiProperty, PickType } from "@nestjs/swagger";
import { BaseFindDto } from "../../utils/base-find.dto";
import { UserFollow } from "../entity/user-follow.entity";

export class FollowInfoRequestDto extends PickType(BaseFindDto<UserFollow>, [
    "offset",
    "limit",
    "orderBy",
]) {
    @IsNotEmpty()
    @IsString()
    @Length(36)
    targetUserId: string;
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        enum: ["followers", "following"],
    })
    criteria: "followers" | "following";
}
