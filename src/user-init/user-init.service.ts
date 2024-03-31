import { Injectable, Logger } from "@nestjs/common";
import { CollectionsService } from "../collections/collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { ProfileService } from "../profile/profile.service";
import UserRoles from "supertokens-node/recipe/userroles";
import { EUserRoles } from "../utils/constants";
import { DEFAULT_COLLECTIONS } from "../collections/collections.constants";
import { LevelService } from "../level/level.service";
import { Timeout } from "@nestjs/schedule";
import { AUTH_ERRORS } from "../auth/auth.constants";

/**
 * This service is responsible for initializing data/entities required for usage when a user performs a login. <br>
 */
@Injectable()
export class UserInitService {
    private readonly defaultTenantId = "public";
    private logger = new Logger(UserInitService.name);

    constructor(
        private collectionsService: CollectionsService,
        private librariesService: LibrariesService,
        private profileService: ProfileService,
        private userLevelService: LevelService,
    ) {}

    @Timeout(5000)
    private createUserRoles() {
        this.logger.log("Starting user role creation routine.");
        for (const role of Object.values(EUserRoles)) {
            UserRoles.createNewRoleOrAddPermissions(role, [])
                .then()
                .catch((e) => {
                    this.logger.error(e);
                });
        }
    }

    /**
     * Given a Supertokens userId, initialize said user in our system. <br>
     * This function should be called on the PostSignup event for SuperTokens. <br>
     * Throws errors when any of the init methods fails.
     * @param userId
     * @throws Error
     */
    async init(userId: string) {
        this.logger.log(
            `Started init routine for ${userId} at ${new Date().toISOString()}`,
        );
        const initPromises: Promise<void>[] = [
            this.initUserRole(userId),
            this.initProfile(userId),
            this.initLibrary(userId),
            this.initLevel(userId),
        ];
        try {
            await Promise.all(initPromises);
            this.logger.log(
                `Finished init routine for ${userId} at ${new Date().toISOString()}`,
            );
        } catch (err) {
            this.logger.error(err);
            throw new Error(AUTH_ERRORS.USER_INIT_ERROR);
        }
    }

    private async initUserRole(userId: string) {
        const getRoles = await UserRoles.getRolesForUser(
            this.defaultTenantId,
            userId,
        );
        const roles = getRoles.roles;
        if (
            roles.includes(EUserRoles.MOD) ||
            roles.includes(EUserRoles.ADMIN)
        ) {
            return;
        }
        await UserRoles.addRoleToUser(
            this.defaultTenantId,
            userId,
            EUserRoles.USER,
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
        for (const collectionSpec of DEFAULT_COLLECTIONS) {
            await this.collectionsService.create(userId, collectionSpec);
        }
        this.logger.log(
            `Created default collections for user ${userId} at signup`,
        );
    }

    private async initLevel(userId: string) {
        const userLevelEntity =
            await this.userLevelService.findOneByUserId(userId);

        if (userLevelEntity) {
            return;
        }

        await this.userLevelService.create(userId);
    }
}
