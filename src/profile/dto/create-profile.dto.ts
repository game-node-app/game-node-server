import { IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

export class CreateProfileDto {
    @IsString()
    @Length(4, 20)
    @IsNotEmpty()
    username: string;
    @IsString()
    @Length(1, 240)
    @IsOptional()
    bio: string;
}
