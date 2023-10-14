import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
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

/**
 * Represents an entry in a collection.
 * @class CollectionEntry
 */
@Entity()
@Unique(["collection", "game"])
export class CollectionEntry {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @OneToOne(() => Review, {
        nullable: true,
    })
    @JoinColumn()
    review: Review;

    @Column()
    reviewId: string;

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
    @ManyToMany(() => GamePlatform, {
        nullable: false,
    })
    @JoinColumn()
    ownedPlatforms: GamePlatform[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
