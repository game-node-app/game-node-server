import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import {
    AchievementCategory,
    AchievementIcon,
    AchievementStatus,
} from "../achievements.constants";
import { AchievementEvent } from "./achievement-event.entity";
import { AchievementTier } from "./achievement-tier.entity";

/**
 * An achievement, as edited by admins/editors. Its id is the stable slug.
 */
@Entity()
export class AchievementDefinition {
    @PrimaryColumn({ length: 36 })
    id: string;
    @Column({ length: 100 })
    name: string;
    @Column({ length: 500 })
    description: string;
    @Column({ type: "int" })
    category: AchievementCategory;
    /**
     * Key of a metric registered in achievement-metrics.ts
     */
    @Column({ length: 64 })
    metric: string;
    @Column({ type: "json" })
    criteria: Record<string, any>;
    @Column({ type: "datetime", nullable: true })
    startsAt: Date | null;
    @Column({ type: "datetime", nullable: true })
    endsAt: Date | null;
    @ManyToOne(() => AchievementEvent, { nullable: true })
    event: AchievementEvent | null;
    @Column({ type: "varchar", length: 36, nullable: true })
    eventId: string | null;
    @Column({ type: "json" })
    icon: AchievementIcon;
    @Column({ default: false })
    isHidden: boolean;
    @Column({ type: "varchar", length: 16, default: AchievementStatus.DRAFT })
    status: AchievementStatus;
    @Column({ type: "datetime", nullable: true })
    publishedAt: Date | null;
    @OneToMany(() => AchievementTier, (tier) => tier.definition, {
        cascade: ["insert"],
    })
    tiers: AchievementTier[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
