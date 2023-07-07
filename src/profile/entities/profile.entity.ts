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
        type: "uuid",
    })
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
