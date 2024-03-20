import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "../../entities/collection.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { GamePlatform } from "../../../game/game-repository/entities/game-platform.entity";
import { Review } from "../../../reviews/entities/review.entity";

@Entity()
/**
 * Represents an entry in a collection.
 * @class CollectionEntry
 */
export class CollectionEntry {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToMany(() => Collection, (collection) => collection.entries, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinTable()
    collections: Collection[];

    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({ nullable: false })
    gameId: number;

    /**
     * The platforms on which the user owns the game.
     */
    @ManyToMany(() => GamePlatform, (platform) => platform.collectionEntries, {
        nullable: false,
    })
    @JoinTable()
    ownedPlatforms: GamePlatform[];

    @OneToOne(() => Review, (review) => review.collectionEntry, {
        nullable: true,
    })
    review: Review;

    @Column({
        default: false,
    })
    isFavorite: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
