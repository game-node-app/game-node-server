import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { GameCoverKind } from "../game-cover.constants";

/** Same shape as a game's default cover, so clients can render it the same way. */
export class GameCoverImageDto {
    @ApiProperty({ description: "IGDB image id" })
    id: number;

    @ApiPropertyOptional()
    imageId?: string;

    @ApiPropertyOptional()
    url?: string;

    @ApiPropertyOptional()
    width?: number;

    @ApiPropertyOptional()
    height?: number;

    @ApiPropertyOptional()
    alphaChannel?: boolean;

    @ApiPropertyOptional()
    animated?: boolean;

    @ApiPropertyOptional()
    checksum?: string;
}

export class GameCoverOptionResponseDto {
    @ApiProperty({ description: "Cover option id used when choosing it" })
    id: number;

    @ApiProperty({ enum: GameCoverKind })
    kind: GameCoverKind;

    @ApiProperty({ nullable: true })
    label: string | null;

    @ApiProperty({ type: () => GameCoverImageDto })
    image: GameCoverImageDto;
}
