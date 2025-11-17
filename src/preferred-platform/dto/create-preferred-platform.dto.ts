import {
    IsBoolean,
    IsBooleanString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from "class-validator";
import { ToBoolean } from "../../utils/toBoolean";

export class CreatePreferredPlatformDto {
    @IsNotEmpty()
    @IsNumber()
    platformId: number;
    @IsOptional()
    @IsString()
    label?: string;
    @ToBoolean()
    @IsOptional()
    @IsBoolean()
    isEnabled?: boolean = true;
}
