import {
    Column,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Profile } from "../../../profile/entities/profile.entity";

@Entity()
export class UserLevel {
    @PrimaryGeneratedColumn()
    id: number;

    @OneToOne(() => Profile)
    @JoinColumn()
    profile: Profile;
    @Column({
        nullable: false,
        default: 1,
    })
    currentLevel: number;
    /**
     * XP in the current level
     */
    @Column({
        nullable: false,
        default: 0,
    })
    currentLevelExp: number;
    /**
     * Threshold XP to hit the next level
     */
    @Column({
        nullable: false,
    })
    nextLevelExp: number;
    /**
     * The multiplier to apply to all exp gains
     */
    @Column({
        nullable: false,
        default: 1,
    })
    expMultiplier: number;
}
