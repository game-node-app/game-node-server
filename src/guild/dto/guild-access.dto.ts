import { ApiProperty } from "@nestjs/swagger";

export type GuildAccessMode = "supporters" | "public";

export class GuildAccessResponseDto {
    @ApiProperty({ enum: ["supporters", "public"] })
    mode: GuildAccessMode;

    @ApiProperty()
    hasAccess: boolean;
}
