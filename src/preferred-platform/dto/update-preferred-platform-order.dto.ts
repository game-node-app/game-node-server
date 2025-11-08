import { IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class UpdatePreferredPlatformOrderDto {
    @IsNotEmpty()
    @IsNumber()
    targetPlatformId: number;
    @IsOptional()
    @IsNumber()
    previousPlatformId?: number;
    @IsOptional()
    @IsNumber()
    nextPlatformId?: number;
}
