import { IsArray, IsNotEmpty, IsString } from "class-validator";

export class IconNamesForPlatformRequestDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({ each: true })
    platformAbbreviations: string[];
}
