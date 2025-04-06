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
import { ProfileBanner } from "./profile-banner.entity";

/**
 * Profiles represent a user in the community scope. Unlike 'Library', they should be used by tables representing
 * interactions with the GameNode community (e.g. a user like). <br>
 * Library's, Profile's and Supertokens' userIds are interchangeable.
 */
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
    @OneToOne(() => ProfileAvatar, {
        nullable: true,
    })
    @JoinColumn()
    avatar: ProfileAvatar | null;
    @OneToOne(() => ProfileBanner, {
        nullable: true,
    })
    @JoinColumn()
    banner: ProfileBanner | null;

    @Column({
        type: "timestamp",
        nullable: true,
    })
    usernameLastUpdatedAt: Date | null;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
