import {
    Column,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { YearRecapPlayedGame } from "./year-recap-played-game.entity";
import { YearRecapGenre } from "./year-recap-genre.entity";
import { YearRecapTheme } from "./year-recap-theme.entity";
import { YearRecapMode } from "./year-recap-mode.entity";
import { YearRecapPlatform } from "./year-recap-platform.entity";

@Entity()
export class YearRecap extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
        default: new Date().getFullYear(),
    })
    year: number;
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlayedGames: number;
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlaytimeSeconds: number;
    @Column({
        nullable: false,
        default: 0,
    })
    totalAddedGames: number;
    @Column({
        nullable: false,
    })
    totalReviewsCreated: number;
    @Column({
        nullable: false,
    })
    totalCollectionsCreated: number;
    @Column({
        nullable: false,
    })
    totalFollowersGained: number;
    @Column({
        nullable: false,
    })
    totalLikesReceived: number;
    @OneToMany(
        () => YearRecapPlayedGame,
        (mostPlayedGame) => mostPlayedGame.recap,
        {
            cascade: true,
        },
    )
    playedGames: YearRecapPlayedGame[];
    @OneToMany(() => YearRecapGenre, (genre) => genre.recap, {
        cascade: true,
    })
    genres: YearRecapGenre[];
    @OneToMany(() => YearRecapTheme, (theme) => theme.recap, {
        cascade: true,
    })
    themes: YearRecapTheme[];
    @OneToMany(() => YearRecapMode, (mode) => mode.recap, {
        cascade: true,
    })
    modes: YearRecapMode[];
    @OneToMany(() => YearRecapPlatform, (platform) => platform.recap, {
        cascade: true,
    })
    platforms: YearRecapPlatform[];
}
