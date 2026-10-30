import { Body, Controller, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../../auth/auth.guard";
import { Roles } from "../../../auth/roles.decorator";
import { EUserRoles } from "../../../utils/constants";
import { PsnSyncAuthService } from "../auth/psn-sync-auth.service";
import { RotatePsnNpssoDto } from "../dto/rotate-psn-npsso.dto";

@Controller("psn/admin")
@ApiTags("psn")
@UseGuards(AuthGuard)
@Roles([EUserRoles.ADMIN])
export class PsnAdminController {
    constructor(private readonly authService: PsnSyncAuthService) {}

    @Put("npsso")
    public async rotateNpsso(@Body() dto: RotatePsnNpssoDto) {
        const refreshTokenExpiresAt = await this.authService.rotateNpsso(
            dto.npsso,
        );
        return { refreshTokenExpiresAt };
    }
}
