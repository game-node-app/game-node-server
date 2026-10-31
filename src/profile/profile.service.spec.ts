import { ProfileService } from "./profile.service";
import { lockoutAuthService } from "../../test/mocks/lockout-auth-service.mock";

describe("ProfileService", () => {
    it("reports isSuspended for an active expiring lockout and isBanned for a permanent one", async () => {
        const day = 24 * 60 * 60 * 1000;
        const ids = ["active", "suspended", "expired", "banned", "no-user"];
        const service = new ProfileService(
            { find: async () => ids.map((userId) => ({ userId })) } as any,
            {} as any,
            {} as any,
            lockoutAuthService([
                { id: "active", banned: false },
                {
                    id: "suspended",
                    banned: true,
                    banExpires: new Date(Date.now() + day),
                },
                {
                    id: "expired",
                    banned: true,
                    banExpires: new Date(Date.now() - day),
                },
                { id: "banned", banned: true, banExpires: null },
            ]),
            {} as any,
        );

        const result = await service.findAll();

        expect(
            Object.fromEntries(
                result.map(({ profile, isSuspended, isBanned }) => [
                    profile.userId,
                    { isSuspended, isBanned },
                ]),
            ),
        ).toEqual({
            active: { isSuspended: false, isBanned: false },
            suspended: { isSuspended: true, isBanned: false },
            expired: { isSuspended: false, isBanned: false },
            banned: { isSuspended: false, isBanned: true },
            "no-user": { isSuspended: false, isBanned: false },
        });
    });
});
