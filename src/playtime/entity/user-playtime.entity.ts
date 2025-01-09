import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { UserPlaytimeSource } from "../playtime.constants";
import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";

/**
 * User-provided playtime info. Generally obtained from syncing with third-party
 * stores like Steam and PSN.
 */
@Entity()
export class UserPlaytime {
    @PrimaryGeneratedColumn()
    id: number;
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
    @ManyToMany(() => GameExternalGame, {
        nullable: true,
    })
    @JoinTable()
    externalGames: GameExternalGame[];

    /**
     * Total playtime for this game, in seconds.
     */
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlaytimeSeconds: number;
    /**
     * Recent playtime in seconds.
     * 'Recent' definition varies between sources.
     * For Steam, it's the last two weeks,
     * for PSN, it's not available :p
     */
    @Column({
        nullable: false,
        default: 0,
    })
    recentPlaytimeSeconds: number;

    @Column({
        nullable: true,
        type: "datetime",
    })
    lastPlayedDate: Date | null | undefined;
    @Column({
        nullable: true,
        type: "datetime",
    })
    firstPlayedDate: Date | null | undefined;
    /**
     * Total number of times this game has been played.
     * Not available in Steam.
     */
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
