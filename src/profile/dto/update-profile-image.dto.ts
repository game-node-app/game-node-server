import { IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export const PROFILE_IMAGE_ALLOWED_IDENTIFIERS = ["banner", "avatar"] as const;

export type ProfileImageIdentifier =
    (typeof PROFILE_IMAGE_ALLOWED_IDENTIFIERS)[number];

export class UpdateProfileImageDto {
    file: any;
    @ApiProperty({
        type: "string",
    })
    @IsNotEmpty()
    @IsIn(["avatar", "banner"])
    type: ProfileImageIdentifier;
}
