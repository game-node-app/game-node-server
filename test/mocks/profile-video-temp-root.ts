import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Imported first by specs so every test file gets an isolated temp root.
export const PROFILE_VIDEO_TEST_TEMP_ROOT = mkdtempSync(
    join(tmpdir(), "profile-video-test-"),
);
process.env.PROFILE_VIDEO_TEMP_DIR = PROFILE_VIDEO_TEST_TEMP_ROOT;
