import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { CustomCoverMode } from "../../game/game-cover/game-cover.constants";
import { LibraryVisibility } from "../../libraries/library-visibility.constants";
import { CreateProfileDto } from "./create-profile.dto";

export class UpdateProfileDto extends PartialType(CreateProfileDto) {
    @IsOptional()
    @IsEnum(CustomCoverMode)
    customCoverMode?: CustomCoverMode;
    @ApiPropertyOptional({ enum: LibraryVisibility })
    @IsOptional()
    @IsEnum(LibraryVisibility)
    libraryVisibility?: LibraryVisibility;
}
