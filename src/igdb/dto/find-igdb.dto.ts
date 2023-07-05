import { IsArray, IsNotEmpty, IsString } from "class-validator";
import { Transform } from "class-transformer";
import { ImageSize } from "../igdb.constants";

export class FindIgdbDto {
    coverSize?: ImageSize;
    imageSize?: ImageSize;
    search?: string;
    where?: string | string[];
    limit?: number;
    offset?: number;
    sort?: string;
}
