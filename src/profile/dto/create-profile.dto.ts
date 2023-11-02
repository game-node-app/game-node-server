import { IsNotEmpty, IsString, Length } from "class-validator";

export class CreateProfileDto {
    @IsString()
    @Length(4, 20)
    @IsNotEmpty()
    username: string;
    avatar: any;
}
