import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { EGamePlatformCategory } from "../game.constants";

@Entity()
export class GamePlatform {
    @PrimaryColumn("bigint")
    id: number;
    @Column()
    abbreviation: string;
    @Column()
    alternative_name: string;
    @Column()
    category: EGamePlatformCategory;
    @Column()
    checksum: string;
    @Column()
    generation: number;
    @Column()
    name: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
