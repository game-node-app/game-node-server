import { SetMetadata } from "@nestjs/common";

/**
 * Decorator that enforces user roles to be verified by SuperTokens.
 * MUST be used with the AuthGuard.
 * @param roles
 * @constructor
 */
export const Roles = (roles: string[]) => SetMetadata("roles", roles);
