import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { Expose, Transform } from "class-transformer";
import { FindOptionsOrder } from "typeorm";
import qs from "qs";

/**
 * Base find options for all models.
 */
export class BaseFindDto<T> {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => {
        if (typeof value === "string" && value.trim() === "") {
            return undefined;
        }
        return value;
    })
    search?: string;
    @IsOptional()
    @IsNumber()
    @IsNotEmpty()
    offset?: number = 0;
    @IsOptional()
    @IsNumber()
    @IsNotEmpty()
    limit?: number = 20;
    @IsOptional()
    // Forces orderBy's Transform to run
    @Expose({ name: "orderBy" })
    // This extra logic makes the orderBy work for GET request parameters
    @Transform(({ obj }) => {
        const rawQueryString = qs.stringify(obj);
        const parsed = qs.parse(rawQueryString);

        return parsed.orderBy;
    })
    orderBy?: FindOptionsOrder<T>;
}
