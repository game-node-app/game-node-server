import { Controller, Get, Param } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ProfilePresenceResponseDto } from "./dto/profile-presence.dto";
import { ProfilePresenceService } from "./profile-presence.service";

/** Public like `GET /v1/connections/user/:userId`, which exposes the same account. */
@Controller("profile")
@ApiTags("profile")
export class ProfilePresenceController {
    constructor(
        private readonly profilePresenceService: ProfilePresenceService,
    ) {}

    @Get(":id/presence")
    @ApiOkResponse({ type: ProfilePresenceResponseDto })
    getPresence(
        @Param("id") userId: string,
    ): Promise<ProfilePresenceResponseDto> {
        return this.profilePresenceService.getPresence(userId);
    }
}
