import { ApiProperty } from "@nestjs/swagger";

export class PlayingGameDto {
    @ApiProperty({ enum: ["steam"] })
    source: "steam";

    @ApiProperty()
    name: string;

    @ApiProperty({ type: Number, nullable: true })
    gameId: number | null;
}

export class ProfilePresenceResponseDto {
    @ApiProperty({ type: () => PlayingGameDto, nullable: true })
    playing: PlayingGameDto | null;
}
