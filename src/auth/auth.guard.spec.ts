import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { Roles } from "./roles.decorator";
import { EUserRoles } from "../utils/constants";

@Roles([EUserRoles.ADMIN])
class ClassRolesController {
    adminOnly() {}

    @Roles([EUserRoles.USER])
    anyUser() {}
}

describe("AuthGuard", () => {
    const guardFor = (role: string) =>
        new AuthGuard(new Reflector(), {
            getSession: jest
                .fn()
                .mockResolvedValue({ user: { id: "user-id", role } }),
        } as unknown as AuthService);

    const contextFor = (handler: () => void) =>
        new ExecutionContextHost([{}], ClassRolesController, handler);

    it("applies class-level roles to handlers without their own", async () => {
        await expect(
            guardFor("user").canActivate(
                contextFor(ClassRolesController.prototype.adminOnly),
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            guardFor("user,admin").canActivate(
                contextFor(ClassRolesController.prototype.adminOnly),
            ),
        ).resolves.toBe(true);
    });

    it("lets handler-level roles override class-level roles", async () => {
        await expect(
            guardFor("user").canActivate(
                contextFor(ClassRolesController.prototype.anyUser),
            ),
        ).resolves.toBe(true);
    });
});
