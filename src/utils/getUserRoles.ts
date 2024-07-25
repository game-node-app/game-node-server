import UserRoles from "supertokens-node/recipe/userroles";
import { DEFAULT_TENANT_ID } from "../auth/auth.constants";

export async function getUserRoles(userId: string) {
    const query = await UserRoles.getRolesForUser(DEFAULT_TENANT_ID, userId);
    return query.roles;
}
