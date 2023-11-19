import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { EGamePlatformCategory } from "../game-repository.constants";
import { Game } from "./game.entity";
import { CollectionEntry } from "../../../collections/collections-entries/entities/collection-entry.entity";

@Entity()
export class GamePlatform {
    @PrimaryColumn("bigint")
    id: number;
    @Column({
        nullable: true,
    })
    abbreviation: string;
    @Column({
        nullable: true,
    })
    alternative_name: string;
    @Column({
        default: EGamePlatformCategory.Console,
    })
    category: EGamePlatformCategory;
    @Column({
        nullable: true,
    })
    checksum: string;
    @Column({
        nullable: true,
    })
    generation: number;
    @Column()
    name: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
    // Relationships
    @ManyToMany(() => Game, (game) => game.platforms, {
        nullable: true,
    })
    @JoinTable()
    games: Game[];
    @ManyToMany(
        () => CollectionEntry,
        (collectionEntry) => collectionEntry.ownedPlatforms,
        {
            nullable: true,
        },
    )
    collectionEntries: CollectionEntry[];
}
