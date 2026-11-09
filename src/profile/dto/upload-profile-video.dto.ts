import { ApiProperty } from "@nestjs/swagger";

export class UploadProfileVideoResponseDto {
    @ApiProperty({ type: "string", enum: ["processing"] })
    status: "processing";
}
