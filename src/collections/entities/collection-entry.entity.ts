import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "./collection.entity";
import { GameMetadata } from "../../utils/game-metadata.dto";
import { DataSources } from "../../app.constants";
import { Review } from "../../reviews/entities/review.entity";

/**
 * The entity that represents a game in a collection.
 * The only necessary information is the id from the source (IGDB).
 * Information about the game will be fetched from the source when needed.
 * Only IGDB entries are accepted.
 */
@Entity()
export class CollectionEntry {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ nullable: false })
    igdbId: number;
    @Column({
        nullable: false,
        type: "json",
    })
    data: GameMetadata;

    /**
     * The source from which the game was added to the collection.
     */
    @Column({ type: "json" })
    dataSources: DataSources[];

    @OneToOne(() => Review, {
        nullable: true,
    })
    @JoinColumn()
    review: Review;

    @ManyToOne(() => Collection, (collection) => collection.entries, {
        nullable: false,
    })
    collection: Collection;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
