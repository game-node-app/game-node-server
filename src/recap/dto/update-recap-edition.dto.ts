import { Type } from "class-transformer";
import { IsDate } from "class-validator";

export class UpdateRecapEditionDto {
    @Type(() => Date)
    @IsDate()
    opensAt: Date;
}
