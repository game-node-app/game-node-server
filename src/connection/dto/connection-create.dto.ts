import { EConnectionType } from "../connections.constants";
import {
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
} from "class-validator";

export class ConnectionCreateDto {
    @IsNotEmpty()
    @IsEnum(EConnectionType)
    type: EConnectionType;
    /**
     * A string representing a username, user id or profile URL for the target connection <br>
     * e.g. a Steam's profile URL
     */
    @IsString()
    @MinLength(1)
    userIdentifier: string;
    @IsBoolean()
    @IsOptional()
    isImporterEnabled: boolean = true;
    @IsBoolean()
    @IsOptional()
    isPlaytimeImportEnabled: boolean = true;
}
