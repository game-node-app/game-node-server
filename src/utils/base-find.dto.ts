import {
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateIf,
} from "class-validator";
import { Transform } from "class-transformer";
import { FindOptionsRelations } from "typeorm";

/**
 * Base find options for all entities.
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
    @IsString()
    @IsNotEmpty()
    orderBy?: string;
    @ValidateIf((o) => o.orderBy != null)
    @IsString()
    @IsNotEmpty()
    orderDirection?: "ASC" | "DESC";

    relations?: FindOptionsRelations<T>;
}
