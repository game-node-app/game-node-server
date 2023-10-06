import { Column, Entity, OneToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class Cover {
    @PrimaryColumn("bigint")
    id: number;
    @Column()
    alphaChannel: boolean;
    @Column()
    animated: boolean;
    @OneToOne(() => Game, (game) => game.cover)
    game: Game;
    @Column()
    height: number;
    @Column()
    imageId: string;
    @Column()
    url: string;
    @Column()
    width: number;
}
