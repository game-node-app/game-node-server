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
import { Game } from "../../game/game-repository/entities/game.entity";
import { Unique } from "typeorm";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";

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

    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;

    @OneToOne(() => CollectionEntry, (entry) => entry.review, {
        nullable: false,
    })
    collectionEntry: CollectionEntry;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
