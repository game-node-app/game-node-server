import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ActivityType } from "../../activities-queue/activities-queue.constants";
import { Profile } from "../../../profile/entities/profile.entity";

@Entity()
export class Activity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({
        nullable: false,
    })
    type: ActivityType;
    @Index()
    @Column({
        nullable: false,
    })
    sourceId: string;
    @Column({
        type: "simple-json",
        nullable: true,
    })
    metadata: object | null;
    /**
     * The associated profile with this Activity
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({ nullable: false })
    profileUserId: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
