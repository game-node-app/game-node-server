import { ArrayMaxSize, ArrayUnique, IsArray, IsNumber } from "class-validator";

export const MAX_NOMINATIONS_PER_CATEGORY = 3;

export class UpdateNominationsDto {
    /** Empty clears the user's nominations for the category. */
    @IsArray()
    @ArrayUnique()
    @ArrayMaxSize(MAX_NOMINATIONS_PER_CATEGORY)
    @IsNumber({}, { each: true })
    gameIds: number[];
}
