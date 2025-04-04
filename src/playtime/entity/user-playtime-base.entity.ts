import {
    Column,
    CreateDateColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserPlaytimeSource } from "../playtime.constants";
import { Profile } from "../../profile/entities/profile.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { ApiProperty } from "@nestjs/swagger";

export abstract class UserPlaytimeBase {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    source: UserPlaytimeSource;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column()
    profileUserId: string;

    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column()
    gameId: number;

    /**
     * Since a user can have a single game in more than one source, this helps us identify
     * where it has been imported from.
     */
    @ManyToOne(() => GameExternalGame, {
        nullable: false,
    })
    externalGame: GameExternalGame;
    @Column()
    externalGameId: number;

    /**
     * Total playtime for this game, in seconds.
     */
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlaytimeSeconds: number;
    @Column({
        nullable: false,
        default: 0,
    })
    recentPlaytimeSeconds: number;

    @ApiProperty({
        type: Date,
        nullable: true,
    })
    @Column({
        nullable: true,
        type: "datetime",
    })
    lastPlayedDate: Date | null | undefined;
    @ApiProperty({
        type: Date,
        nullable: true,
    })
    @Column({
        nullable: true,
        type: "datetime",
    })
    firstPlayedDate: Date | null | undefined;
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlayCount: number;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
