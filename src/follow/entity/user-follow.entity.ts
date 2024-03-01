import {
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
    @ManyToOne(() => Profile)
    followed: Profile;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
