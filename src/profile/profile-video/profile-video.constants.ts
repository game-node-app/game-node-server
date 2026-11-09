import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProfileImageIdentifier } from "../dto/update-profile-image.dto";
import type { NormalizedCrop } from "./profile-video-media";

export const PROFILE_VIDEO_QUEUE_NAME = "profile-video";
export const PROFILE_VIDEO_JOB_NAME = "process-profile-video";

export const PROFILE_VIDEO_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
export const PROFILE_VIDEO_STALE_MS = 30 * 60 * 1000;
export const PROFILE_VIDEO_TEMP_MAX_AGE_MS = 60 * 60 * 1000;
export const PROFILE_VIDEO_TEMP_ROOT =
    process.env.PROFILE_VIDEO_TEMP_DIR ?? join(tmpdir(), "profile-video");

export interface ProfileVideoJobData {
    userId: string;
    type: ProfileImageIdentifier;
    sourcePath: string;
    crop?: NormalizedCrop;
    attemptId: string;
}

export interface ProfileVideoUpload {
    type: ProfileImageIdentifier;
    crop?: NormalizedCrop;
}
