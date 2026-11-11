import { Body, Controller, Patch, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../../auth/auth.guard";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { SupporterGuard } from "../../billing/supporter.guard";
import { SupporterPreferencesResponseDto } from "../dto/profile-response.dto";
import { UpdateSupporterPreferencesDto } from "./dto/update-supporter-preferences.dto";
import { SupporterPreferencesValues } from "./supporter-preferences.defaults";
import { SupporterPreferencesService } from "./supporter-preferences.service";

@Controller("profile/supporter-preferences")
@ApiTags("profile")
@UseGuards(AuthGuard, SupporterGuard)
export class SupporterPreferencesController {
    constructor(
        private readonly supporterPreferencesService: SupporterPreferencesService,
    ) {}

    @Patch()
    @ApiOkResponse({ type: SupporterPreferencesResponseDto })
    update(
        @Session() session: SessionContainer,
        @Body() dto: UpdateSupporterPreferencesDto,
    ): Promise<SupporterPreferencesValues> {
        return this.supporterPreferencesService.update(
            session.getUserId(),
            dto,
        );
    }
}
