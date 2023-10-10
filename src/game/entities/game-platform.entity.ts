import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { EGamePlatformCategory } from "../game.constants";
import { Game } from "./game.entity";

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
}
