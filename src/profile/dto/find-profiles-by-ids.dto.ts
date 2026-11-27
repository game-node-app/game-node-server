import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from "class-validator";

export class FindProfilesByIdsDto {
    @ApiProperty({
        type: [String],
        description: "Profile user IDs (up to 100)",
    })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @IsString({ each: true })
    userIds: string[];
}
