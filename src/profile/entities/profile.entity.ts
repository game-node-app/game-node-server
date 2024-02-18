import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ProfileAvatar } from "./profile-avatar.entity";

@Entity()
export class Profile {
    /**
     * Shareable string ID
     *
     * Same as SuperTokens' userId.
     */
    @PrimaryColumn({
        nullable: false,
        length: 36,
        type: "varchar",
    })
    userId: string;
    @Column({ nullable: false, unique: true, length: 20 })
    username: string;
    @Column({
        nullable: true,
        type: "varchar",
        length: 240,
    })
    bio: string;
    @OneToOne(() => ProfileAvatar, (avatar) => avatar.profile, {
        nullable: true,
    })
    @JoinColumn()
    avatar: ProfileAvatar;

    @Column({
        default: 0,
    })
    followersCount: number;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
