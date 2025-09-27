import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { AwardsCategoryResult } from "./awards-category-result.entity";
import { Game } from "../../game/game-repository/entities/game.entity";

/**
 * Entity representing a winner game in a category.
 */
@Entity()
@Unique(["result", "game", "position"])
export class AwardsCategoryResultWinner {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AwardsCategoryResult)
    result: AwardsCategoryResult;
    @Column({
        nullable: false,
    })
    resultId: number;
    @ManyToOne(() => Game)
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    @Column({
        nullable: false,
        type: "smallint",
        default: 1,
    })
    position: number;
    @Column({
        nullable: false,
    })
    totalVotes: number;
    /**
     * Percentage of votes for this game in relation to the total votes.
     * Only for the target category.
     * @example 0.5
     */
    @Column({
        nullable: false,
        type: "float",
    })
    votesPercentage: number;
}
