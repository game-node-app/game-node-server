import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
@Unique(["follower", "followed"])
export class UserFollow {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile)
    follower: Profile;
    @Column()
    followerUserId: string;
    @ManyToOne(() => Profile)
    followed: Profile;
    @Column()
    followedUserId: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
