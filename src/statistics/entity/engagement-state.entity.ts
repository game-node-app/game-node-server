import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    Unique,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { StatisticsTarget } from "./statistics-target.entity";

@Entity("engagement_state")
@Unique("UQ_engagement_state_target_actor", ["targetId", "profileUserId"])
export class EngagementState {
    @ManyToOne(() => StatisticsTarget, { nullable: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "targetId" })
    target: StatisticsTarget;

    @Column({ type: "bigint", unsigned: true, primary: true })
    targetId: number;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "profileUserId", referencedColumnName: "userId" })
    profile: Profile;

    @Column({ type: "varchar", length: 36, primary: true })
    profileUserId: string;

    @Column({ type: "datetime", precision: 6, nullable: true })
    likedAt: Date | null;

    @Column({ type: "datetime", precision: 6, nullable: true })
    firstLikedAt: Date | null;

    @Column({ type: "datetime", precision: 6, nullable: true })
    lastViewedAt: Date | null;
}
