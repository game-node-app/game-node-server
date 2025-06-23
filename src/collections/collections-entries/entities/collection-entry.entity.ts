import {
    Column,
    CreateDateColumn,
    Entity,
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

/**
 * Represents an entry (game) in one or multiple collections. <br>
 * Each CollectionEntry corresponds to a single game, but may be available in multiple collections.
 * @class CollectionEntry
 */
@Entity()
export class CollectionEntry {
    @Expose()
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Expose()
    @Column({ nullable: false })
    gameId: number;
    /**
     * The platforms on which the user owns the game.
     */
    @ManyToMany(() => GamePlatform, (platform) => platform.collectionEntries, {
        nullable: false,
    })
    @JoinTable()
    @Expose()
    ownedPlatforms: GamePlatform[];

    @OneToMany(() => CollectionEntryToCollection, (map) => map.collectionEntry)
    collectionsMap: CollectionEntryToCollection[];

    @Expose()
    @ApiProperty({
        type: () => Collection, // important: wrap in function to avoid circular refs
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
    @Expose()
    isFavorite: boolean;
    @Column({
        nullable: false,
        default: CollectionEntryStatus.PLANNED,
        type: "varchar",
    })
    @Expose()
    status: CollectionEntryStatus;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    @Expose()
    finishedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    @Expose()
    startedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    @Expose()
    droppedAt: Date | null;

    @Column({
        nullable: true,
        type: "timestamp",
    })
    @Expose()
    plannedAt: Date | null;

    @CreateDateColumn()
    @Expose()
    createdAt: Date;

    @UpdateDateColumn()
    @Expose()
    updatedAt: Date;
}
