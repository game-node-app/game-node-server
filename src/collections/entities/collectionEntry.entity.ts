import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "./collection.entity";
import { DataSources } from "../../igdb/igdb.constants";
import { GameMetadata } from "../../utils/game-metadata.dto";

/**
 * The entity that represents a game in a collection.
 * The only necessary information is the id from the source (IGDB).
 * Information about the game will be fetched from the source when needed.
 * Only IGDB entries are accepted.
 */
@Entity()
export class CollectionEntry {
    /**
     * Not to be confused with the igdbId property from GameMetadata
     */
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Redudant, since it's also available in the data property.
     * Still, this allows us to easily find a entry by the igdbId, so it's worth it.
     * Feel free to open a PR if you have a better idea (i know you do).
     */
    @Column({ nullable: false })
    igdbId: number;
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
