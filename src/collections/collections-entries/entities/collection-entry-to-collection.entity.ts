import { Column, Entity, Index, ManyToOne, PrimaryColumn } from "typeorm";
import { CollectionEntry } from "./collection-entry.entity";
import { Collection } from "../../entities/collection.entity";

@Entity({
    name: "collection_entry_collections_collection",
})
export class CollectionEntryToCollection {
    @PrimaryColumn({
        type: "varchar",
        length: 36,
    })
    @Index()
    collectionEntryId: string;

    @PrimaryColumn({
        type: "varchar",
        length: 36,
    })
    @Index()
    collectionId: string;

    @Column({
        type: "float",
        default: 0,
    })
    order: number;

    @ManyToOne(() => CollectionEntry, (ce) => ce.collectionsMap, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    collectionEntry: CollectionEntry;

    @ManyToOne(() => Collection, (c) => c.entriesMap, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    collection: Collection;
}
