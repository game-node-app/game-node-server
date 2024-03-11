import { Injectable, Logger } from "@nestjs/common";
import { CollectionsService } from "../collections/collections.service";
import { LibrariesService } from "../libraries/libraries.service";
import { ProfileService } from "../profile/profile.service";
import UserRoles from "supertokens-node/recipe/userroles";
import { EUserRoles } from "../utils/constants";
import { DEFAULT_COLLECTIONS } from "../collections/collections.constants";
import { LevelService } from "../level/level.service";
import { Timeout } from "@nestjs/schedule";
import { AmqpConnection } from "@golevelup/nestjs-rabbitmq";
import {
    USER_INIT_RABBITMQ_EXCHANGE,
    USER_INIT_RABBITMQ_ROUTING_KEY,
} from "./user-init.constants";

/**
 * This service is responsible for initializing data/entities required for usage when a user performs a login. <br>
 */
@Injectable()
export class UserInitService {
    private readonly defaultTenantId = "public";
    private logger = new Logger(UserInitService.name);

    constructor(
        private amqpConnection: AmqpConnection,
        private collectionsService: CollectionsService,
        private librariesService: LibrariesService,
        private profileService: ProfileService,
        private userLevelService: LevelService,
    ) {}

    /**
     * Notifies other listening services of a new user sign-in/up.
     */
    public dispatchUserInitEvent(userId: string) {
        this.amqpConnection
            .publish(
                USER_INIT_RABBITMQ_EXCHANGE,
                USER_INIT_RABBITMQ_ROUTING_KEY,
                userId,
            )
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    @Timeout(2000)
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

    private async initUserRole(userId: string) {
        try {
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
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Initialize the user
     * This function should be called on the PostSignup event for SuperTokens.
     * @param userId
     */
    async init(userId: string) {
        this.logger.log(
            `Started init routine for userId ${userId} at ${new Date().toISOString()}`,
        );
        const initPromises: Promise<void>[] = [
            this.initUserRole(userId),
            this.initProfile(userId),
            this.initLibrary(userId),
            this.initLevel(userId),
        ];

        try {
            await Promise.all(initPromises);
        } catch (e: unknown) {
            console.error(e);
        }
    }

    private async initProfile(userId: string) {
        try {
            const possibleUserProfile =
                await this.profileService.findOneById(userId);
            if (possibleUserProfile) {
                return;
            }
            await this.profileService.create(userId);
        } catch (e: any) {
            this.logger.error(
                `Failed to create profile for user ${userId} at signup/in`,
                e,
            );
        }
    }

    private async initLibrary(userId: string) {
        try {
            const possibleUserLibrary =
                await this.librariesService.findOneById(userId);
            if (possibleUserLibrary) {
                return;
            }

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
                `Failed to create library and default collections for user ${userId} at signup/in`,
                e,
            );
        }
    }

    private async initLevel(userId: string) {
        try {
            const userLevelEntity =
                await this.userLevelService.findOneByUserId(userId);

            if (userLevelEntity) {
                return;
            }

            await this.userLevelService.create(userId);
        } catch (e: any) {
            console.error(e);
        }
    }
}
