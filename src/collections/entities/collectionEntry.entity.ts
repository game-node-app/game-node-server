import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "./collection.entity";
import { GameMetadata } from "../../utils/game-metadata.dto";
import { DataSources } from "../../app.constants";

/**
 * The entity that represents a game in a collection.
 * The only necessary information is the id from the source (IGDB).
 * Information about the game will be fetched from the source when needed.
 * Only IGDB entries are accepted.
 */
@Entity()
export class CollectionEntry {
    @PrimaryColumn()
    igdbId: number;

    // This should have the same name as the generated column in from the Collection relationship.
    @PrimaryColumn()
    collectionId: string;

    @Column({
        nullable: false,
        type: "json",
    })
    data: GameMetadata;

    @ManyToOne(() => Collection, (collection) => collection.entries, {
        nullable: false,
    })
    collection: Collection;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
