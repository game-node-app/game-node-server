import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameVideo {
    @PrimaryColumn({ type: "bigint" })
    id: number;

    @Column("text", { nullable: true })
    name: string | null;

    @Column("text", { nullable: true })
    videoId: string | null;

    @Column("text", { nullable: true })
    checksum: string | null;

    @Column("text", { nullable: true })
    url: string | null;

    @ManyToOne(() => Game, (game) => game.videos)
    game: Game;
}
