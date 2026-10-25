import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class ConnectionAuthInitDto {
    @IsBoolean()
    @IsOptional()
    isAutoImportEnabled?: boolean = false;

    @IsUUID()
    @IsOptional()
    autoImportCollectionId?: string | null;
}

export class ConnectionAuthInitResponseDto {
    authorizationUrl: string;
    state: string;
}
