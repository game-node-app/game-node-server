import { Body, Controller, Delete, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AwardsAdminService } from "./awards-admin.service";
import { CreateUpdateAwardsEventDto } from "../dto/create-update-awards-event.dto";
import { CreateUpdateAwardsCategoryDto } from "../dto/create-update-awards-category.dto";
import { AddCategorySuggestionDto } from "../dto/add-category-suggestion.dto";
import { AuthGuard } from "../../auth/auth.guard";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";

@Controller("awards/admin")
@ApiTags("awards")
@UseGuards(AuthGuard)
@Roles([EUserRoles.ADMIN])
export class AwardsAdminController {
    constructor(private readonly awardsAdminService: AwardsAdminService) {}

    @Post("event")
    public async createOrUpdateEvent(@Body() dto: CreateUpdateAwardsEventDto) {
        await this.awardsAdminService.createAwardsEvent(dto);
    }

    @Post("category")
    public async createUpdateCategory(
        @Body() dto: CreateUpdateAwardsCategoryDto,
    ) {
        await this.awardsAdminService.createOrUpdateAwardsCategory(dto);
    }

    @Post("category/suggestion")
    public async addCategorySuggestion(@Body() dto: AddCategorySuggestionDto) {
        await this.awardsAdminService.addCategorySuggestion(dto);
    }

    @Delete("category/suggestion")
    public async removeCategorySuggestion(
        @Body() dto: AddCategorySuggestionDto,
    ) {
        await this.awardsAdminService.removeCategorySuggestion(dto);
    }
}
