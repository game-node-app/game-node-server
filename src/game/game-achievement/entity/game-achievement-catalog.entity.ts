import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";
import { GameAchievementDto } from "../dto/game-achievement.dto";

/**
 * The achievements a store lists for one external game, as last fetched from it.
 * Reads come from here instead of the store; an empty list means the store has none.
 */
@Entity("game_achievement_catalog")
export class GameAchievementCatalog {
    @PrimaryColumn({ type: "bigint" })
    externalGameId: number;
    @ManyToOne(() => GameExternalGame, { onDelete: "CASCADE" })
    @JoinColumn({ name: "externalGameId" })
    externalGame?: GameExternalGame;
    @Column({ type: "json" })
    achievements: GameAchievementDto[];
    @Column({ type: "datetime", precision: 6 })
    fetchedAt: Date;
}
