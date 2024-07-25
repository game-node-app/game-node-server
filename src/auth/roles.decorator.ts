import { SetMetadata } from "@nestjs/common";
import { EUserRoles } from "../utils/constants";

/**
 * Decorator used at the controller level that enforces
 * user roles to be verified by SuperTokens. <br>
 * Will allow method execution if <strong>ANY</strong> of the listed roles are present. <br>
 * <strong>MUST be used with the AuthGuard.</strong>
 * @see AuthGuard
 * @param roles
 * @constructor
 * @usage
 * ```typescript
 * // Only admins can execute this route...
 * @Post("generate")
 * @UseGuards(AuthGuard)
 * @Roles([EUserRoles.ADMIN])
 * async generate(@Body() dto: CreateAchievementCodeRequestDto) {
 *   return this.achievementsCodeService.create(dto);
 * }
 * ```
 */
export const Roles = (roles: EUserRoles[]) =>
    SetMetadata(
        "roles",
        roles.map((role) => role.valueOf()),
    );
