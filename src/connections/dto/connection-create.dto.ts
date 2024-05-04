import { EConnectionType } from "../connections.constants";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class ConnectionCreateDto {
    @IsNotEmpty()
    @IsEnum(EConnectionType)
    type: EConnectionType;
    @IsOptional()
    @IsString()
    sourceUserId: string;
    @IsOptional()
    @IsString()
    sourceUsername: string;
}
