import { Injectable, Logger } from "@nestjs/common";
import { CollectionsService } from "../collections/collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { ProfileService } from "../profile/profile.service";
import UserRoles from "supertokens-node/recipe/userroles";
import { EUserRoles } from "../utils/constants";
import { DEFAULT_COLLECTIONS } from "../collections/collections.constants";

@Injectable()
export class UserInitService {
    private logger = new Logger(UserInitService.name);

    constructor(
        private collectionsService: CollectionsService,
        private librariesService: LibrariesService,
        private profileService: ProfileService,
    ) {}

    /**
     * Initialize the user
     * This function should be called on the PostSignup event for SuperTokens.
     *
     * The initialization should not fail no matter what. If it does, unexpected things
     * may happen in all endpoints.
     *
     * Make sure to implement uninitialized handlers for each resource.
     * @param userId
     */
    async initUser(userId: string) {
        this.logger.log(
            `Started init routine for userId ${userId} at ${new Date().toISOString()}`,
        );

        try {
            await UserRoles.addRoleToUser(userId, EUserRoles.USER);
        } catch (e) {}

        try {
            await this.librariesService.create(userId);
            this.logger.log(`Created library for user ${userId} at signup`);
            for (const defCollection of DEFAULT_COLLECTIONS) {
                // Registers the promise but does not wait for it
                this.collectionsService
                    .create(userId, defCollection)
                    .then()
                    .catch();
            }
            this.logger.log(
                `Created default collections for user ${userId} at signup`,
            );
        } catch (e: any) {
            this.logger.error(
                `Failed to create library and default collections for user ${userId} at signup`,
                e,
            );
        }

        try {
            await this.profileService.create(userId);
        } catch (e: any) {
            this.logger.error(
                `Failed to create profile for user ${userId} at signup`,
                e,
            );
        }
    }
}
