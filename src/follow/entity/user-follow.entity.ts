import {
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
export class UserFollow {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToMany(() => Profile)
    @JoinTable()
    follower: Profile;
    @ManyToMany(() => Profile)
    @JoinTable()
    followed: Profile;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
