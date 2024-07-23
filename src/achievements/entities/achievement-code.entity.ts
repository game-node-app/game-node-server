import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Entity defining an achievement code that can be consumed by a user to receive the
 * associated achievement.
 */
@Entity()
export class AchievementCode {
    /**
     * Generated code used to retrieve this achievement.
     * @see AchievementsCodeService#generateCode
     */
    @PrimaryColumn()
    id: string;

    @Column({
        nullable: false,
    })
    achievementId: string;

    @Column({
        type: "timestamp",
        nullable: false,
    })
    expiresAt: Date;

    @Column({
        nullable: false,
        default: false,
    })
    isForceExpired: boolean;

    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    consumedBy: Profile | null;

    @Column({
        nullable: true,
    })
    consumedByUserId: string | null;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
