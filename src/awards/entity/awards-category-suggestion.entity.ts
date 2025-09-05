import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { AwardsCategory } from "./awards-category.entity";

@Entity()
export class AwardsCategorySuggestion extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    @ManyToOne(() => AwardsCategory, {
        nullable: false,
    })
    category: AwardsCategory;
    @Column({
        nullable: false,
    })
    categoryId: number;
}
