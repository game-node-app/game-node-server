import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import type { AwardsCategoryLocale } from "../entity/awards-category-translation.entity";

export class AwardsCategoryTranslationDto {
    @ApiProperty({ enum: ["en", "pt-BR"] })
    locale: AwardsCategoryLocale;
    @ApiProperty()
    name: string;
    @ApiProperty()
    description: string;
}

export class AwardsCategoryTranslationInputDto {
    @ApiProperty({ enum: ["en", "pt-BR"] })
    @IsIn(["en", "pt-BR"])
    locale: AwardsCategoryLocale;
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @Transform(({ obj, key }) => obj[key])
    name: string;
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @Transform(({ obj, key }) => obj[key])
    description: string;
}
