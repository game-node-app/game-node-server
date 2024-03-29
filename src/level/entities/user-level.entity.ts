import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { BASE_LEVEL_UP_COST } from "../level.constants";

@Entity()
export class UserLevel {
    /**
     * Should be the same as the profile's UserId
     */
    @PrimaryColumn()
    userId: string;

    @OneToOne(() => Profile)
    @JoinColumn()
    profile: Profile;
    @Column({
        nullable: false,
        default: 1,
    })
    currentLevel: number;
    /**
     * XP in the current user-level
     */
    @Column({
        nullable: false,
        default: 0,
    })
    currentLevelExp: number;
    /**
     * Threshold XP to hit the next user-level
     */
    @Column({
        nullable: false,
        default: BASE_LEVEL_UP_COST,
    })
    levelUpExpCost: number;
    /**
     * The multiplier to apply to all exp gains
     */
    @Column({
        type: "float",
        nullable: false,
        default: 1,
    })
    expMultiplier: number;
}
