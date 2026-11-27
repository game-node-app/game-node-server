import { IsArray, IsNotEmpty, IsString } from "class-validator";
import { MaxListSize } from "../../utils/request-bounds";

export class FindAllReviewsByIdDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({
        each: true,
    })
    @MaxListSize()
    reviewsIds: string[];
}
