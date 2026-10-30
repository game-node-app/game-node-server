import { EUserRoles } from "../../../utils/constants";
import { PsnAdminController } from "./psn-admin.controller";

describe("PsnAdminController", () => {
    test("rotation returns only the expiry, never the NPSSO", async () => {
        const rotateNpsso = jest.fn().mockResolvedValue("2027-01-01T00:00:00.000Z");
        const controller = new PsnAdminController({ rotateNpsso } as any);
        const result = await controller.rotateNpsso({ npsso: "secret" });
        expect(rotateNpsso).toHaveBeenCalledWith("secret");
        expect(result).toEqual({ refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z" });
    });

    test("route is admin-only", () => {
        expect(Reflect.getMetadata("roles", PsnAdminController)).toEqual([EUserRoles.ADMIN]);
    });
});
