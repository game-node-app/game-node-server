import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    PROFILE_VIDEO_TEMP_MAX_AGE_MS,
    PROFILE_VIDEO_TEMP_ROOT,
} from "./profile-video.constants";
import { ensureProfileVideoTempRoot } from "./profile-video.service";

@Injectable()
export class ProfileVideoTempService implements OnModuleInit {
    private readonly logger = new Logger(ProfileVideoTempService.name);

    async onModuleInit() {
        await ensureProfileVideoTempRoot();
        await this.sweep();
    }

    @Cron("0 * * * *")
    async sweep() {
        const cutoff = Date.now() - PROFILE_VIDEO_TEMP_MAX_AGE_MS;
        const entries = await readdir(PROFILE_VIDEO_TEMP_ROOT, {
            withFileTypes: true,
        }).catch(() => []);

        for (const entry of entries) {
            const path = join(PROFILE_VIDEO_TEMP_ROOT, entry.name);
            const details = await stat(path).catch(() => null);
            if (!details || details.mtimeMs >= cutoff) continue;

            await rm(path, { recursive: true, force: true }).catch((error) =>
                this.logger.warn(`Could not remove ${path}: ${error}`),
            );
        }
    }
}
