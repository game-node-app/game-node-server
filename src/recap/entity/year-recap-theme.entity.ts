import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { GameTheme } from "../../game/game-repository/entities/game-theme.entity";
import { YearRecap } from "./year-recap.entity";

@Entity()
export class YearRecapTheme extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => GameTheme, {
        nullable: false,
    })
    theme: GameTheme;
    @Column({
        nullable: false,
    })
    themeId: number;
    @ManyToOne(() => YearRecap, (recap) => recap.themes, {
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
