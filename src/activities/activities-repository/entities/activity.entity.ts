import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ActivityType } from "../../activities-queue/activities-queue.constants";
import { Profile } from "../../../profile/entities/profile.entity";

@Entity()
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
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
