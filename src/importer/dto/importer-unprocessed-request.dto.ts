import { BaseFindDto } from "../../utils/base-find.dto";
import { ApiPropertyOptional, PickType } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";

export class ImporterUnprocessedRequestDto extends PickType(BaseFindDto<any>, [
    "limit",
    "offset",
    "search",
]) {
    @ApiPropertyOptional({ type: Boolean, default: false })
    @IsOptional()
    @IsBoolean()
    @Transform(({ obj, key }) => {
        const value = obj[key];
        return value === "true" ? true : value === "false" ? false : value;
    })
    excludeInLibrary?: boolean;
}
