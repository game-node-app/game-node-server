import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import {
    CreateGuildEventDto,
    CreateGuildRewardDto,
    GuildAdminEventResponseDto,
    GuildAdminRewardResponseDto,
    UpdateGuildEventDto,
    UpdateGuildRewardDto,
} from "./dto/guild-admin.dto";
import { GuildAdminService } from "./guild-admin.service";

/** Admin/editor editorial management for the Adventurers Guild (spec: curated events). */
@Controller("guild/admin")
@ApiTags("guild-admin")
@UseGuards(AuthGuard)
@Roles([EUserRoles.ADMIN, EUserRoles.EDITOR])
export class GuildAdminController {
    constructor(private readonly adminService: GuildAdminService) {}

    @Get("events")
    @ApiOkResponse({ type: [GuildAdminEventResponseDto] })
    listEvents() {
        return this.adminService.listEvents();
    }

    @Get("events/:id")
    @ApiOkResponse({ type: GuildAdminEventResponseDto })
    getEvent(@Param("id") id: string) {
        return this.adminService.getEvent(id);
    }

    @Post("events")
    @ApiCreatedResponse({ type: GuildAdminEventResponseDto })
    createEvent(@Body() dto: CreateGuildEventDto) {
        return this.adminService.createEvent(dto);
    }

    @Patch("events/:id")
    @ApiOkResponse({ type: GuildAdminEventResponseDto })
    updateEvent(@Param("id") id: string, @Body() dto: UpdateGuildEventDto) {
        return this.adminService.updateEvent(id, dto);
    }

    @Post("events/:id/publish")
    @ApiCreatedResponse({ type: GuildAdminEventResponseDto })
    publishEvent(@Param("id") id: string) {
        return this.adminService.publishEvent(id);
    }

    @Post("events/:id/archive")
    @ApiCreatedResponse({ type: GuildAdminEventResponseDto })
    archiveEvent(@Param("id") id: string) {
        return this.adminService.archiveEvent(id);
    }

    @Get("rewards")
    @ApiOkResponse({ type: [GuildAdminRewardResponseDto] })
    listRewards() {
        return this.adminService.listRewards();
    }

    @Post("rewards")
    @ApiCreatedResponse({ type: GuildAdminRewardResponseDto })
    createReward(@Body() dto: CreateGuildRewardDto) {
        return this.adminService.createReward(dto);
    }

    @Patch("rewards/:id")
    @ApiOkResponse({ type: GuildAdminRewardResponseDto })
    updateReward(@Param("id") id: string, @Body() dto: UpdateGuildRewardDto) {
        return this.adminService.updateReward(id, dto);
    }
}
