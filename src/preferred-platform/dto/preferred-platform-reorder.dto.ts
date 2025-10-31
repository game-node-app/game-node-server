import { IsNotEmpty, IsNumber, IsOptional } from "class-validator";

export class PreferredPlatformReorderDto {
    @IsNotEmpty()
    @IsNumber()
    id: number;
    @IsOptional()
    @IsNumber()
    previousId?: number;
    @IsOptional()
    @IsNumber()
    nextId?: number;
}
