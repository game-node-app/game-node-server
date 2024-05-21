import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";
import { FindOptionsOrder } from "typeorm";
import { FindOptionsOrderValue } from "typeorm/find-options/FindOptionsOrder";

export class BaseFindOptionsOrder {
    createdAt: FindOptionsOrderValue;
    updatedAt: FindOptionsOrderValue;
}

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
    orderBy?: FindOptionsOrder<T>;
}
