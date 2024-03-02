import { IsArray, IsNotEmpty, IsString } from "class-validator";

export class FindAllReviewsByIdDto {
    @IsNotEmpty()
    @IsArray()
    @IsString({
        each: true,
    })
    reviewsIds: string[];
}
