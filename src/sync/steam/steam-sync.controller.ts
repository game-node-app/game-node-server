import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SteamSyncService } from "./steam-sync.service";
import { SteamUserIdResolveRequestDto } from "./dto/steam-user-id-resolve-request.dto";
import { AuthGuard } from "../../auth/auth.guard";

@Controller("steam-sync")
@ApiTags("steam-sync")
@UseGuards(AuthGuard)
export class SteamSyncController {
    constructor(private readonly steamSyncService: SteamSyncService) {}

    @Post("resolve")
    async resolveUserId(@Body() dto: SteamUserIdResolveRequestDto) {
        return this.steamSyncService.resolveUserInfo(dto.query);
    }
}
