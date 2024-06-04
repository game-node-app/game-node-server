import { SetMetadata } from "@nestjs/common";
import { EUserRoles } from "../utils/constants";

/**
 * Decorator that enforces user roles to be verified by SuperTokens.
 * MUST be used with the AuthGuard.
 * @see AuthGuard
 * @param roles
 * @constructor
 */
export const Roles = (roles: EUserRoles[]) =>
    SetMetadata(
        "roles",
        roles.map((role) => role.valueOf()),
    );
