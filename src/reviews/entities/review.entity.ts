import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ReviewStatistics } from "../../statistics/entity/review-statistics.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { Game } from "../../game/game-repository/entities/game.entity";

@Entity()
export class Review {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({ nullable: false, type: "longtext" })
    content: string;
    @Column({ nullable: false })
    rating: number;

    @OneToOne(() => Game, {
        nullable: false,
    })
    @JoinColumn()
    game: Game;

    @OneToOne(
        () => ReviewStatistics,
        (reviewStatistics) => reviewStatistics.review,
    )
    @JoinColumn()
    reviewStatistics: ReviewStatistics;

    @OneToOne(
        () => CollectionEntry,
        (collectionEntry) => collectionEntry.review,
    )
    collectionEntry: CollectionEntry;

    @ManyToOne(() => Profile)
    profile: Profile;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
