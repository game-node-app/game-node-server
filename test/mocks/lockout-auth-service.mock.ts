import { AuthService } from "../../src/auth/auth.service";

export type LockoutUserRow = {
    id: string;
    banned?: boolean | null;
    banExpires?: Date | null;
};

/**
 * A real AuthService (so getLockoutStates runs its own expiry logic) whose Better Auth adapter
 * returns these user rows instead of querying the database.
 */
export function lockoutAuthService(users: LockoutUserRow[]): AuthService {
    const service = Object.create(AuthService.prototype);
    service.auth = {
        $context: Promise.resolve({
            adapter: {
                findMany: async ({ where }: { where: { value: string[] }[] }) =>
                    users.filter((user) => where[0].value.includes(user.id)),
            },
        }),
    };
    return service;
}
