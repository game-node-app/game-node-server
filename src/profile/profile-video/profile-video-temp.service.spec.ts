import { PROFILE_VIDEO_TEST_TEMP_ROOT } from "../../../test/mocks/profile-video-temp-root";

import { mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ProfileVideoTempService } from "./profile-video-temp.service";

const OLD = new Date(Date.now() - 2 * 60 * 60 * 1000);

async function exists(path: string): Promise<boolean> {
    return stat(path).then(
        () => true,
        () => false,
    );
}

describe("ProfileVideoTempService", () => {
    let service: ProfileVideoTempService;

    beforeEach(async () => {
        await rm(PROFILE_VIDEO_TEST_TEMP_ROOT, {
            recursive: true,
            force: true,
        });
        await mkdir(PROFILE_VIDEO_TEST_TEMP_ROOT, { recursive: true });
        service = new ProfileVideoTempService();
    });

    afterEach(async () => {
        await rm(PROFILE_VIDEO_TEST_TEMP_ROOT, {
            recursive: true,
            force: true,
        });
    });

    it("removes entries older than one hour and keeps newer ones", async () => {
        const oldDirectory = join(PROFILE_VIDEO_TEST_TEMP_ROOT, "old-job");
        await mkdir(oldDirectory);
        await writeFile(join(oldDirectory, "source"), "source");
        await utimes(oldDirectory, OLD, OLD);

        const oldFile = join(PROFILE_VIDEO_TEST_TEMP_ROOT, "old-upload");
        await writeFile(oldFile, "source");
        await utimes(oldFile, OLD, OLD);

        const newDirectory = join(PROFILE_VIDEO_TEST_TEMP_ROOT, "new-job");
        await mkdir(newDirectory);
        await writeFile(join(newDirectory, "source"), "source");

        const newFile = join(PROFILE_VIDEO_TEST_TEMP_ROOT, "new-upload");
        await writeFile(newFile, "source");

        await service.sweep();

        await expect(exists(oldDirectory)).resolves.toBe(false);
        await expect(exists(oldFile)).resolves.toBe(false);
        await expect(exists(newDirectory)).resolves.toBe(true);
        await expect(exists(newFile)).resolves.toBe(true);
    });

    it("sweeps older entries at startup", async () => {
        const leftover = join(PROFILE_VIDEO_TEST_TEMP_ROOT, "leftover");
        await writeFile(leftover, "source");
        await utimes(leftover, OLD, OLD);

        await service.onModuleInit();

        await expect(exists(leftover)).resolves.toBe(false);
    });

    it("creates a traversable temp root that nobody else can write", async () => {
        await service.onModuleInit();

        const mode = (await stat(PROFILE_VIDEO_TEST_TEMP_ROOT)).mode & 0o777;
        expect(mode.toString(8)).toBe("755");
    });
});
