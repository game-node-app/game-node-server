import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SteamSyncService } from "./steam-sync.service";
import { SteamUserIdResolveRequestDto } from "./dto/steam-user-id-resolve-request.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { Session } from "../../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";

@Controller("steam-sync")
@ApiTags("steam-sync")
@UseGuards(AuthGuard)
export class SteamSyncController {
    constructor(private readonly steamSyncService: SteamSyncService) {}

    @Post("resolve")
    async resolveUserId(
        @Session() session: SessionContainer,
        @Body() dto: SteamUserIdResolveRequestDto,
    ) {
        return this.steamSyncService.resolveUserInfo(
            session.getUserId(),
            dto.query,
        );
    }
}
