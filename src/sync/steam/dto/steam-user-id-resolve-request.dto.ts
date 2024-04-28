import { IsNotEmpty, IsString } from "class-validator";

export class SteamUserIdResolveRequestDto {
    @IsNotEmpty()
    @IsString()
    query: string;
}
