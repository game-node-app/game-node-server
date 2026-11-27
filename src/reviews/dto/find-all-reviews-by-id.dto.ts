import { IsArray, IsNotEmpty, IsString } from "class-validator";
import { MaxListSize } from "../../utils/request-bounds";

export class FindAllReviewsByIdDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({
        each: true,
    })
    // Each review loads its relations; clients batch at most 100 ids per request.
    @MaxListSize(100)
    reviewsIds: string[];
}
