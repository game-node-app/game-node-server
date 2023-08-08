import {
    Column,
    CreateDateColumn,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { Profile } from "../../profile/entities/profile.entity";
import { ActivityStatistics } from "../../statistics/entity/activity-statistics.entity";

export class Activity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column()
    type: ActivityType;
    @Column()
    sourceId: string;
    /**
     * The associated profile with this Activity
     */
    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;

    @OneToOne(() => ActivityStatistics, (statistics) => statistics.activity)
    @JoinColumn()
    statistics: ActivityStatistics;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
