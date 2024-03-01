import { IsNotEmpty, IsString, Max, Min } from "class-validator";

export class FollowRegisterDto {
    @IsNotEmpty()
    @IsString()
    @Min(36)
    @Max(36)
    followedUserId: string;
}
