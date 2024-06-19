import { SetMetadata } from "@nestjs/common";
import { EUserRoles } from "../utils/constants";

/**
 * Decorator that enforces user roles to be verified by SuperTokens. <br>
 * Will allow method execution if <strong>ANY</strong> of the listed roles are present. <br>
 * <strong>MUST be used with the AuthGuard.</strong>
 * @see AuthGuard
 * @param roles
 * @constructor
 */
export const Roles = (roles: EUserRoles[]) =>
    SetMetadata(
        "roles",
        roles.map((role) => role.valueOf()),
    );
