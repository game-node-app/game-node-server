import { IsIn, IsNotEmpty, IsNumber } from "class-validator";
import {
    PROFILE_IMAGE_ALLOWED_IDENTIFIERS,
    ProfileImageIdentifier,
} from "./update-profile-image.dto";

export class DeleteProfileImageDto {
    @IsNotEmpty()
    @IsIn(PROFILE_IMAGE_ALLOWED_IDENTIFIERS)
    imageType: ProfileImageIdentifier;
    @IsNotEmpty()
    @IsNumber()
    imageId: number;
}
