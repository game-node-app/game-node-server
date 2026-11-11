import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { Profile } from "./profile.entity";

/** One row per supporter who changed a preference; a missing row means the defaults (design 2). */
@Entity("profile_supporter_preferences")
export class ProfileSupporterPreferences {
    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;

    @OneToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_profile_supporter_preferences_profile",
    })
    profile: Profile;

    @Column({ type: "boolean", default: true })
    showBadge: boolean;

    @Column({ type: "varchar", length: 32, nullable: true, default: null })
    titleKey: string | null;

    @Column({ type: "boolean", default: true })
    showAnimatedAvatarBorder: boolean;

    @Column({ type: "boolean", default: true })
    showSupporterTheme: boolean;

    @Column({ type: "char", length: 7, nullable: true, default: null })
    accentColor: string | null;

    @Column({ type: "boolean", default: true })
    showOnSupportersWall: boolean;

    @Column({ type: "boolean", default: false })
    showLiveProfile: boolean;
}
