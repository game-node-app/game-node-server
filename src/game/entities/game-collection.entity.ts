import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryColumn,
} from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameCollection {
    @PrimaryColumn("bigint")
    id: number;
    @Column()
    name: string;
    @Column()
    slug: string;
    @Column()
    createdAt: Date;
    @Column()
    updatedAt: Date;
    @Column()
    checksum: string;
    @Column()
    url: string;

    @OneToMany(() => Game, (game) => game.collection)
    games: Game[];
}
