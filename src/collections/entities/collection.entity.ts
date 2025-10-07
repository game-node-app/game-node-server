import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Library } from "../../libraries/entities/library.entity";
import { CollectionEntry } from "../collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "../collections-entries/collections-entries.constants";
import { CollectionEntryToCollection } from "../collections-entries/entities/collection-entry-to-collection.entity";
import { Expose } from "class-transformer";

@Entity()
export class Collection {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ nullable: false })
    name: string;
    @Column({
        nullable: true,
    })
    description: string;
    @Column({ nullable: false, default: false })
    isPublic: boolean;
    @ManyToOne(() => Library, (library) => library.collections, {
        nullable: false,
        onDelete: "CASCADE",
    })
    library: Library;
    @Column({
        nullable: false,
    })
    libraryUserId: string;
    /**
     * The default status for collection entries added to this collection.
     */
    @Column({
        nullable: true,
        type: "varchar",
    })
    defaultEntryStatus: CollectionEntryStatus | null;

    @OneToMany(() => CollectionEntryToCollection, (map) => map.collection)
    entriesMap: CollectionEntryToCollection[];

    @Expose()
    public get entries(): CollectionEntry[] {
        return this.entriesMap?.map((map) => map.collectionEntry) ?? [];
    }

    @Column({
        nullable: false,
        default: false,
    })
    isFeatured: boolean;
    // TODO: Drop this
    @Column({
        nullable: false,
        default: false,
    })
    isFinished: boolean;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
