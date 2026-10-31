import {
    Column,
    Entity,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { AchievementDefinition } from "./achievement-definition.entity";

/**
 * Last evaluated metric value of a definition for a user.
 */
@Entity()
export class AchievementProgress {
    @PrimaryColumn({ length: 36 })
    profileUserId: string;
    @PrimaryColumn({ length: 36 })
    definitionId: string;
    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    profile: Profile;
    @ManyToOne(() => AchievementDefinition, {
        nullable: false,
        onDelete: "CASCADE",
    })
    definition: AchievementDefinition;
    @Column({ default: 0 })
    value: number;
    @UpdateDateColumn()
    updatedAt: Date;
}
