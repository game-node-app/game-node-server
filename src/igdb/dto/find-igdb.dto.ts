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
