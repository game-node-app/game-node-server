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
    @Column({ nullable: true, type: "longtext" })
    content: string | null;
    @Column({ nullable: false, type: "float" })
    rating: number;
    @ManyToOne(() => Game, {
        nullable: false,
        onDelete: "CASCADE",
    })
    game: Game;
    @Column({ nullable: false })
    gameId: number;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
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
        onDelete: "CASCADE",
    })
    @JoinColumn()
    collectionEntry: CollectionEntry;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
