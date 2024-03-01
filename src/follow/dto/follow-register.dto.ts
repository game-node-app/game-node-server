import { IsNotEmpty, IsString, Length } from "class-validator";

export class FollowRegisterDto {
    @IsNotEmpty()
    @IsString()
    @Length(36)
    followedUserId: string;
}
