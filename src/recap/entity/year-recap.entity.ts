import {
    Column,
    Entity,
    Index,
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

export interface RecapCommunityHighlight {
    gameId: number;
    userRating: number;
    communityAverage: number;
    reviewCount: number;
    beyondShare: number;
    sameRangeCount: number;
}

export interface RecapCommunityHighlights {
    minority: RecapCommunityHighlight | null;
    inTune: RecapCommunityHighlight | null;
}

@Entity()
@Index(["profileUserId", "year"], { unique: true })
export class YearRecap extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
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
        default: 0,
    })
    totalFinishedGames: number;
    @Column({
        nullable: false,
        default: 0,
    })
    totalDroppedGames: number;
    /**
     * Final Recaps are never regenerated.
     */
    @Column({ type: "boolean", default: false })
    isFinal: boolean;
    /**
     * Playtime seconds per UTC day of the year. Null for Recaps generated before the calendar existed.
     */
    @Column({ type: "json", nullable: true })
    dailyPlaytimeSeconds: number[] | null;
    /**
     * Community comparison stored at generation time (design 13).
     */
    @Column({ type: "json", nullable: true })
    communityHighlights: RecapCommunityHighlights | null;
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
    totalLikesPerformed: number;
    @Column({ type: "boolean", default: false })
    likesHistoryComplete: boolean;
    @Column({ type: "datetime", precision: 6, nullable: true })
    likesCompleteSince: Date | null;
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
