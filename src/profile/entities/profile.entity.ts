import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { ProfileAvatar } from "./profile-avatar.entity";

@Entity()
export class Profile {
    // Same as SuperTokens' userId
    @PrimaryColumn()
    id: string;
    @Column({ nullable: true })
    username?: string;

    @OneToOne(() => ProfileAvatar, (avatar) => avatar.profile, {
        nullable: true,
        cascade: true,
    })
    @JoinColumn()
    avatar: ProfileAvatar;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
