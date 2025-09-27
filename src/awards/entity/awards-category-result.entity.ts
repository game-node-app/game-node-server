import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { AwardsCategory } from "./awards-category.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { AwardsCategoryResultWinner } from "./awards-category-winner.entity";

/**
 * Entity representing the result of an award event for a category.
 */
@Entity()
export class AwardsCategoryResult {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    totalVotesCount: number;
    @Column({
        nullable: false,
    })
    totalUniqueGamesSubmitted: number;
    @Column({
        nullable: false,
    })
    totalUsersParticipating: number;
    @Column({
        nullable: false,
    })
    categoryId: number;
    @OneToOne(() => AwardsCategory)
    @JoinColumn()
    category: AwardsCategory;
    @OneToMany(() => AwardsCategoryResultWinner, (winner) => winner.result)
    winners: AwardsCategoryResultWinner[];
}
