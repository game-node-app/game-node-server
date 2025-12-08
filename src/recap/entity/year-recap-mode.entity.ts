import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { YearRecap } from "./year-recap.entity";
import { BaseEntity } from "../../utils/db/base.entity";
import { GameMode } from "../../game/game-repository/entities/game-mode.entity";

@Entity()
export class YearRecapMode extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => GameMode)
    mode: GameMode;
    @Column({
        nullable: false,
    })
    modeId: number;
    @ManyToOne(() => YearRecap, (recap) => recap.modes, {
        onDelete: "CASCADE",
    })
    recap: YearRecap;
    @Column({
        nullable: false,
    })
    recapId: number;
    @Column({
        nullable: false,
        default: 0,
    })
    totalGames: number;
}
