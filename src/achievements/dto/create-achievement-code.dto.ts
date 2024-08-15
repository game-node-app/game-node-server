import { IsDate, IsNotEmpty, IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateAchievementCodeRequestDto {
    @IsNotEmpty()
    @IsString()
    achievementId: string;
    @IsNotEmpty()
    @IsDate()
    @ApiProperty({
        type: "date-time",
    })
    expiresAt: Date;
}

export class CreateAchievementCodeResponseDto {
    code: string;
    expiresAt: Date;
}
