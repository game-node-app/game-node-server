import { IsNotEmpty, IsObject, IsString } from "class-validator";

export class ConnectionAuthCallbackDto {
    @IsString()
    @IsNotEmpty()
    state: string;

    @IsObject()
    @IsNotEmpty()
    callbackParams: Record<string, any>;
}
