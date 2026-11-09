import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { Game } from "../../game-repository/entities/game.entity";
import { GameCoverKind, GameCoverOrigin } from "../game-cover.constants";

/**
 * A cover IGDB offers for a game besides its primary cover. Options are catalog data: one per
 * (origin, igdbId), so a replaced source updates the same row and keeps user choices.
 */
@Entity()
@Unique("UQ_game_cover_option_origin_igdb", ["origin", "igdbId"])
export class GameCoverOption {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id: number;

    @Index("IDX_game_cover_option_game")
    @Column({ type: "bigint" })
    gameId: number;

    @ManyToOne(() => Game, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "gameId",
        foreignKeyConstraintName: "FK_game_cover_option_game",
    })
    game: Game;

    @Column({ type: "varchar", length: 16 })
    kind: GameCoverKind;

    @Column({ type: "varchar", length: 16 })
    origin: GameCoverOrigin;

    @Column({ type: "bigint" })
    igdbId: number;

    // Image columns mirror GameImage/GameCover.
    @Column("text", { nullable: true })
    imageId?: string;
    @Column("text", { nullable: true })
    url?: string;
    @Column("int", { nullable: true })
    width?: number;
    @Column("int", { nullable: true })
    height?: number;
    @Column("boolean", { nullable: true })
    alphaChannel?: boolean;
    @Column("boolean", { nullable: true })
    animated?: boolean;
    @Column("text", { nullable: true })
    checksum?: string;

    @Column({ type: "varchar", length: 255, nullable: true })
    label: string | null;
}
