import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from "typeorm";
import { Profile } from "../../../profile/entities/profile.entity";
import { Game } from "../../game-repository/entities/game.entity";
import { GameCoverOption } from "./game-cover-option.entity";

/** One cover choice per user and game, independent of library entries. */
@Entity()
export class UserGameCover {
    @PrimaryColumn({ type: "varchar", length: 36 })
    userId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "userId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_user_game_cover_profile",
    })
    profile: Profile;

    @Index("IDX_user_game_cover_game")
    @PrimaryColumn({ type: "bigint" })
    gameId: number;

    @ManyToOne(() => Game, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "gameId",
        foreignKeyConstraintName: "FK_user_game_cover_game",
    })
    game: Game;

    @Index("IDX_user_game_cover_option")
    @Column({ type: "bigint" })
    coverOptionId: number;

    @ManyToOne(() => GameCoverOption, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "coverOptionId",
        foreignKeyConstraintName: "FK_user_game_cover_option",
    })
    coverOption: GameCoverOption;
}
