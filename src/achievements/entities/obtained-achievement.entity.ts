import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { AchievementDefinition } from "./achievement-definition.entity";

/**
 * Entity to track a user's obtained achievement tiers (one row per tier)
 */
@Entity()
@Unique(["achievementId", "profile", "tier"])
export class ObtainedAchievement {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Id (slug) of the related AchievementDefinition
     */
    @Column({
        nullable: false,
        length: 36,
    })
    achievementId: string;
    @ManyToOne(() => AchievementDefinition, { nullable: false })
    @JoinColumn({ name: "achievementId" })
    definition?: AchievementDefinition;
    @Column({ default: 1 })
    tier: number;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
    @Column({
        default: false,
    })
    isFeatured: boolean;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
