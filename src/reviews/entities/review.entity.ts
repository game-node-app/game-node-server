import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
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

    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;

    @OneToMany(
        () => CollectionEntry,
        (collectionEntry) => collectionEntry.review,
    )
    collectionEntries: CollectionEntry[];

    @ManyToOne(() => Profile)
    profile: Profile;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
