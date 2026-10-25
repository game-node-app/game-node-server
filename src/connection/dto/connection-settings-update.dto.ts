import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class ConnectionSettingsUpdateDto {
    @IsBoolean()
    @IsOptional()
    isAutoImportEnabled?: boolean;

    @IsUUID()
    @IsOptional()
    autoImportCollectionId?: string | null;
}
