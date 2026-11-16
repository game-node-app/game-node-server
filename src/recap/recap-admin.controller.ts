import { Body, Controller, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { EUserRoles } from "../utils/constants";
import { UpdateRecapEditionDto } from "./dto/update-recap-edition.dto";
import { RecapWindowService } from "./recap-window.service";

@Controller("recap/admin")
@ApiTags("recap")
@UseGuards(AuthGuard)
@Roles([EUserRoles.ADMIN])
export class RecapAdminController {
    constructor(private readonly recapWindowService: RecapWindowService) {}

    @Put("editions/:year")
    public async updateEdition(
        @Param("year") year: number,
        @Body() dto: UpdateRecapEditionDto,
    ) {
        return this.recapWindowService.setRecapEdition(year, dto.opensAt);
    }
}
