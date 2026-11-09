import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import type { ProfileImageIdentifier } from "../dto/update-profile-image.dto";
import { Profile } from "./profile.entity";

export type ProfileVideoStatus = "processing" | "ready" | "failed";
export type ProfileVideoErrorCode =
    | "conversion_failed"
    | "output_too_large"
    | "upload_failed"
    | "source_missing"
    | "timeout";

/** One row per profile slot; the published video survives while a new attempt runs (design 4). */
@Entity("profile_video")
@Unique("UQ_profile_video_profile_type", ["profileUserId", "type"])
export class ProfileVideo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_profile_video_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 16 })
    type: ProfileImageIdentifier;

    @Column({ type: "varchar", length: 255, nullable: true })
    filename: string | null;

    @Column({ type: "int", nullable: true })
    size: number | null;

    @Column({ type: "int", nullable: true })
    durationMs: number | null;

    @Column({ type: "int", nullable: true })
    width: number | null;

    @Column({ type: "int", nullable: true })
    height: number | null;

    @Column({ type: "varchar", length: 16, nullable: true })
    status: ProfileVideoStatus | null;

    @Column({ type: "varchar", length: 36, nullable: true })
    attemptId: string | null;

    @Column({ type: "varchar", length: 32, nullable: true })
    errorCode: ProfileVideoErrorCode | null;

    @Column({ type: "timestamp", precision: 3, nullable: true })
    processingStartedAt: Date | null;
}
