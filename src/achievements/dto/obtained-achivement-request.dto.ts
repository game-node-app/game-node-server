import { IsNotEmpty, IsString } from "class-validator";

export class GetObtainedAchievementRequestDto {
    @IsNotEmpty()
    @IsString()
    targetUserId: string;
}
