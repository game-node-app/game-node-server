import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "../../entities/collection.entity";
import { Review } from "../../../reviews/entities/review.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { GamePlatform } from "../../../game/game-repository/entities/game-platform.entity";

@Entity()
// Games should be unique per collection, but duplicates are allowed across the user's library.
@Unique(["collection", "game"])
/**
 * Represents an entry in a collection.
 * @class CollectionEntry
 */
export class CollectionEntry {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => Review, {
        nullable: true,
    })
    review?: Review | null;

    @Column({
        nullable: true,
    })
    reviewId: string | null;

    @ManyToOne(() => Collection, (collection) => collection.entries, {
        nullable: false,
    })
    collection: Collection;

    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;

    /**
     * The platforms on which the user owns the game.
     */
    @ManyToMany(() => GamePlatform, (platform) => platform.collectionEntries, {
        nullable: false,
    })
    @JoinTable()
    ownedPlatforms: GamePlatform[];

    @Column({
        default: false,
    })
    isFavorite: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
