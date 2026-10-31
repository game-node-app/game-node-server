import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { AchievementDefinition } from "./achievement-definition.entity";

@Entity()
@Unique(["definition", "level"])
export class AchievementTier {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AchievementDefinition, (definition) => definition.tiers, {
        nullable: false,
        onDelete: "CASCADE",
    })
    definition: AchievementDefinition;
    @Column({ length: 36 })
    definitionId: string;
    /**
     * 1-based position of this tier in its definition.
     */
    @Column()
    level: number;
    @Column()
    threshold: number;
    @Column()
    expReward: number;
    /**
     * Number of profiles that obtained this tier, used for rarity.
     */
    @Column({ default: 0 })
    obtainedCount: number;
}
