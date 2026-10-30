import { IsNotEmpty, IsString } from "class-validator";

export class RotatePsnNpssoDto {
    @IsString()
    @IsNotEmpty()
    npsso: string;
}
