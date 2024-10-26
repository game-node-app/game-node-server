import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";

@Entity()
export class GamePlaytime {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        type: "bigint",
        nullable: false,
    })
    gameId: number;
    @OneToOne(() => Game, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    game: Game;
    // HLTB id
    @Column({
        nullable: false,
    })
    sourceId: number;
    @Column({
        type: "bigint",
        nullable: true,
    })
    timeMain: number | null;
    @Column({
        type: "bigint",
        nullable: true,
    })
    timePlus: number | null;
    @Column({
        type: "bigint",
        nullable: true,
    })
    time100: number | null;
    @Column({
        type: "bigint",
        nullable: true,
    })
    timeAll: number | null;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
