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
 * A user's finished-games target for one year.
 */
@Entity("year_goal")
export class YearGoal {
    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;
    @PrimaryColumn({ type: "int" })
    year: number;
    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    profile: Profile;
    @Column({ type: "int" })
    finishedGamesTarget: number;
    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;
    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
