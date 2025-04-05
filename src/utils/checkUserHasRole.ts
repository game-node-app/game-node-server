import UserRoles from "supertokens-node/recipe/userroles";
import { DEFAULT_TENANT_ID } from "../auth/auth.constants";

export async function checkUserHasRole(userId: string, roles: string[]) {
    const userRoles = (
        await UserRoles.getRolesForUser(DEFAULT_TENANT_ID, userId)
    ).roles;

    return userRoles.some((role) => roles.includes(role));
}
