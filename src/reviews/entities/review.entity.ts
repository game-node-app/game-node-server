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
import { Profile } from "../../profile/entities/profile.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
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
    @Column({ nullable: false })
    gameId: number;
    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;
    @Column({
        nullable: false,
        type: "varchar",
        length: 36,
    })
    profileUserId: string;

    @OneToOne(() => CollectionEntry, (entry) => entry.review, {
        nullable: false,
    })
    @JoinColumn()
    collectionEntry: CollectionEntry;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
