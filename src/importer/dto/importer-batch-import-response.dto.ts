import { ApiProperty } from "@nestjs/swagger";

export class ImporterBatchImportResponseDto {
    @ApiProperty()
    importedCount: number;

    @ApiProperty()
    skippedCount: number;
}
