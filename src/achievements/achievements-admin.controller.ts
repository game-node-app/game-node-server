import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { AchievementsAdminService } from "./achievements-admin.service";
import {
    AchievementMetricDto,
    CreateAchievementDefinitionDto,
    CreateAchievementEventDto,
    SimulateAchievementDefinitionDto,
    SimulateAchievementDefinitionResponseDto,
    UpdateAchievementDefinitionDto,
    UpdateAchievementEventDto,
} from "./dto/achievement-admin.dto";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";

// AuthGuard reads roles per handler, so every route repeats @Roles
const EDITORS = [EUserRoles.ADMIN, EUserRoles.EDITOR];

@Controller("achievements/admin")
@ApiTags("achievements-admin")
@UseGuards(AuthGuard)
export class AchievementsAdminController {
    constructor(private readonly adminService: AchievementsAdminService) {}

    @Get("metrics")
    @Roles(EDITORS)
    @ApiOkResponse({ type: [AchievementMetricDto] })
    getMetrics() {
        return this.adminService.getMetrics();
    }

    @Get("definitions")
    @Roles(EDITORS)
    @ApiOkResponse({ type: [AchievementDefinition] })
    findDefinitions() {
        return this.adminService.findDefinitions();
    }

    @Get("definitions/:id")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementDefinition })
    findDefinition(@Param("id") id: string) {
        return this.adminService.findDefinitionOrFail(id);
    }

    @Post("definitions")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementDefinition })
    createDefinition(@Body() dto: CreateAchievementDefinitionDto) {
        return this.adminService.createDefinition(dto);
    }

    @Patch("definitions/:id")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementDefinition })
    updateDefinition(
        @Param("id") id: string,
        @Body() dto: UpdateAchievementDefinitionDto,
    ) {
        return this.adminService.updateDefinition(id, dto);
    }

    @Delete("definitions/:id")
    @Roles(EDITORS)
    deleteDefinition(@Param("id") id: string) {
        return this.adminService.deleteDefinition(id);
    }

    @Post("definitions/:id/publish")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementDefinition })
    publishDefinition(@Param("id") id: string) {
        return this.adminService.publishDefinition(id);
    }

    @Post("definitions/:id/archive")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementDefinition })
    archiveDefinition(@Param("id") id: string) {
        return this.adminService.archiveDefinition(id);
    }

    @Post("definitions/:id/simulate")
    @Roles(EDITORS)
    @ApiOkResponse({ type: SimulateAchievementDefinitionResponseDto })
    simulateDefinition(
        @Param("id") id: string,
        @Body() dto: SimulateAchievementDefinitionDto,
    ) {
        return this.adminService.simulateDefinition(id, dto.userId);
    }

    @Get("events")
    @Roles(EDITORS)
    @ApiOkResponse({ type: [AchievementEvent] })
    findEvents() {
        return this.adminService.findEvents();
    }

    @Get("events/:id")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementEvent })
    findEvent(@Param("id") id: string) {
        return this.adminService.findEventOrFail(id);
    }

    @Post("events")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementEvent })
    createEvent(@Body() dto: CreateAchievementEventDto) {
        return this.adminService.createEvent(dto);
    }

    @Patch("events/:id")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementEvent })
    updateEvent(
        @Param("id") id: string,
        @Body() dto: UpdateAchievementEventDto,
    ) {
        return this.adminService.updateEvent(id, dto);
    }

    @Delete("events/:id")
    @Roles(EDITORS)
    deleteEvent(@Param("id") id: string) {
        return this.adminService.deleteEvent(id);
    }

    @Post("events/:id/publish")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementEvent })
    publishEvent(@Param("id") id: string) {
        return this.adminService.publishEvent(id);
    }

    @Post("events/:id/archive")
    @Roles(EDITORS)
    @ApiOkResponse({ type: AchievementEvent })
    archiveEvent(@Param("id") id: string) {
        return this.adminService.archiveEvent(id);
    }
}
