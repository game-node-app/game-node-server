import { IsIn, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export type ProfileImageIdentifier = "avatar" | "banner";

export class UpdateProfileImageDto {
    file: any;
    @ApiProperty({
        type: "string",
    })
    @IsNotEmpty()
    @IsIn(["avatar", "banner"])
    type: ProfileImageIdentifier;
}
