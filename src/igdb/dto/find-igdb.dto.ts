import { ImageSize } from "../igdb.constants";
import { IsNumber, IsOptional } from "class-validator";

export class FindIgdbDto {
    coverSize?: ImageSize;
    imageSize?: ImageSize;
    search?: string;
    where?: string | string[];
    @IsOptional()
    @IsNumber()
    limit?: number;
    @IsOptional()
    @IsNumber()
    offset?: number;
    sort?: string;
}
