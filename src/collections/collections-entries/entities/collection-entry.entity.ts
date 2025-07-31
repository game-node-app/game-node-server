import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Collection } from "../../entities/collection.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { GamePlatform } from "../../../game/game-repository/entities/game-platform.entity";
import { CollectionEntryToCollection } from "./collection-entry-to-collection.entity";
import { Expose } from "class-transformer";
import { CollectionEntryStatus } from "../collections-entries.constants";
import { ApiProperty } from "@nestjs/swagger";
import { Library } from "../../../libraries/entities/library.entity";

/**
 * Represents an entry (game) in one or multiple collections. <br>
 * Each CollectionEntry corresponds to a single game, but may be available in multiple collections.
 * @class CollectionEntry
 */
@Entity()
export class CollectionEntry {
    @PrimaryGeneratedColumn("uuid")
    id: string;
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

    @OneToMany(() => CollectionEntryToCollection, (map) => map.collectionEntry)
    collectionsMap: CollectionEntryToCollection[];

    @Expose()
    @ApiProperty({
        type: () => Collection,
        description: "Collections this entry belongs to",
        required: true,
        isArray: true,
    })
    public get collections(): Collection[] {
        return this.collectionsMap?.map((map) => map.collection) ?? [];
    }

    @Column({
        default: false,
    })
    isFavorite: boolean;
    @Column({
        nullable: false,
        default: CollectionEntryStatus.PLANNED,
        type: "varchar",
    })
    status: CollectionEntryStatus;

    @ManyToOne(() => Library, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        foreignKeyConstraintName: "FK_collection_entry_library_user",
    })
    library: Library;

    @Column({
        nullable: false,
        type: "varchar",
        length: 36,
    })
    libraryUserId: string;

    @ManyToOne(() => CollectionEntry, {
        onDelete: "SET NULL",
    })
    relatedEntry: CollectionEntry | null;

    @OneToMany(() => CollectionEntry, (entry) => entry.relatedEntry)
    relatedEntries: CollectionEntry[];

    @Column({
        nullable: true,
        type: "timestamp",
    })
    finishedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    startedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    droppedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    plannedAt: Date | null;

    @CreateDateColumn()
    @Expose()
    createdAt: Date;

    @UpdateDateColumn()
    @Expose()
    updatedAt: Date;
}
