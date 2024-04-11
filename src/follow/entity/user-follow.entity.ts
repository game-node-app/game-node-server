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
    @Column({
        nullable: false,
        length: 36,
    })
    followerUserId: string;
    @ManyToOne(() => Profile)
    followed: Profile;
    @Column({
        nullable: false,
        length: 36,
    })
    followedUserId: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
