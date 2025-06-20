import { IsArray, IsBoolean, IsNotEmpty } from "class-validator";

export class UpdateFeaturedObtainedAchievementDto {
    @IsNotEmpty()
    @IsBoolean()
    isFeatured: boolean;
}

export class UpdateFeaturedObtainedAchievementV2Dto {
    /**
     * Obtained achievements ids passed here will be marked as featured, while ids not present will be automatically
     * marked not featured.
     */
    @IsNotEmpty()
    @IsArray()
    featuredAchievementIds: string[];
}
