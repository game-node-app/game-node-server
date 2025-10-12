import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Entity to track a user's obtained achievements
 */
@Entity()
@Unique(["achievementId", "profile"])
export class ObtainedAchievement {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Achievement id specified in entries for achievements.data.ts
     */
    @Column({
        nullable: false,
        length: 36,
    })
    achievementId: string;
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
