import { IsBoolean, IsNotEmpty } from "class-validator";

export class UpdateFeaturedObtainedAchievementDto {
    @IsNotEmpty()
    @IsBoolean()
    isFeatured: boolean;
}
