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
    /**
     * User that is following another user.
     */
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
    })
    follower: Profile;
    /**
     * User that is following another user.
     */
    @Column({
        nullable: false,
        length: 36,
    })
    followerUserId: string;
    /**
     * User that is being followed
     */
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
    })
    followed: Profile;
    /**
     * User that is being followed
     */
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
