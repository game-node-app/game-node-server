import {
    IsBoolean,
    IsDate,
    IsNotEmpty,
    IsOptional,
    IsString,
    Length,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateAchievementCodeRequestDto {
    @IsNotEmpty()
    @IsString()
    achievementId: string;
    @IsNotEmpty()
    @IsDate()
    @ApiProperty({})
    expiresAt: Date;
    @IsBoolean()
    isSingleUse: boolean = true;
}

export class CreateAchievementCodeResponseDto {
    code: string;
    expiresAt: Date;
}

export class RedeemAchievementCodeResponseDto {
    achievementId: string;
    /**
     * Tier obtained by redeeming the code
     */
    tier: number;
}
