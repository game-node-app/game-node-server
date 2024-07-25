import { IsArray, IsNotEmpty, IsString, Length } from "class-validator";

export class AchievementGrantRequestDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({
        each: true,
    })
    @Length(36, undefined, {
        each: true,
    })
    targetUserIds: string[];
    @IsNotEmpty()
    @IsString()
    achievementId: string;
}
