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
    })
    library: Library;

    @OneToMany(
        () => CollectionEntry,
        (collectionEntry) => collectionEntry.collection,
    )
    entries: CollectionEntry[];

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
