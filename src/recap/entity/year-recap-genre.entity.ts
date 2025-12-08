import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { GameGenre } from "../../game/game-repository/entities/game-genre.entity";
import { YearRecap } from "./year-recap.entity";

@Entity()
export class YearRecapGenre extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => GameGenre, {
        nullable: false,
    })
    genre: GameGenre;
    @Column({
        nullable: false,
    })
    genreId: number;
    @ManyToOne(() => YearRecap, (recap) => recap.genres, {
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
