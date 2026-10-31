import { Injectable, Logger } from "@nestjs/common";
import retry from "async-retry";
import { seconds } from "@nestjs/throttler";
import { LibrariesService } from "../../libraries/libraries.service";
import { ProfileService } from "../../profile/profile.service";
import { LevelService } from "../../level/level.service";

/**
 * This service is responsible for initializing data/entities required for usage when a user performs a login. <br>
 */
@Injectable()
export class UserInitService {
    private logger = new Logger(UserInitService.name);

    constructor(
        private librariesService: LibrariesService,
        private profileService: ProfileService,
        private userLevelService: LevelService,
    ) {}

    /**
     * Given a userId, initialize said user in our system. <br>
     * Called on every sign-in by AuthService, so every step must be idempotent. <br>
     * Throws errors when any of the init methods fails.
     * @param userId
     * @throws Error
     */
    async init(userId: string) {
        this.logger.log(
            `Started init routine for ${userId} at ${new Date().toISOString()}`,
        );
        /*
         * For access denied errors:
         *   code: 'ER_ACCESS_DENIED_ERROR',
         *   errno: 1045,
         *   sqlState: '28000',
         *   sqlMessage: "Access denied for user 'xxxxx'@'xxxxxx' (using password: YES)",
         */
        await retry(
            async () => {
                await Promise.all([
                    // Level references the profile, so it is created after it.
                    this.initProfile(userId).then(() =>
                        this.userLevelService.findOneOrCreateByUserId(userId),
                    ),
                    this.initLibrary(userId),
                ]);
            },
            {
                retries: 5,
                maxRetryTime: seconds(60),
                onRetry: (err) => {
                    this.logger.error(
                        `Retrying init for ${userId} at ${new Date().toISOString()}`,
                    );
                    this.logger.error(err);
                },
            },
        );
        this.logger.log(
            `Finished init routine for ${userId} at ${new Date().toISOString()}`,
        );
    }

    private async initProfile(userId: string) {
        const possibleUserProfile =
            await this.profileService.findOneById(userId);
        if (possibleUserProfile) {
            return;
        }
        await this.profileService.create(userId);
        this.logger.log(`Created profile for user ${userId} at signup`);
    }

    private async initLibrary(userId: string) {
        const possibleUserLibrary =
            await this.librariesService.findOneById(userId);
        if (possibleUserLibrary) {
            return;
        }

        await this.librariesService.create(userId);
        this.logger.log(`Created library for user ${userId} at signup`);
    }
}
