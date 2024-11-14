import { Controller, Get, Param } from "@nestjs/common";
import { LevelService } from "./level.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { UserLevel } from "./entities/user-level.entity";

@Controller("level")
@ApiTags("level")
export class LevelController {
    constructor(private readonly userLevelService: LevelService) {}

    @Get(":userId")
    @ApiOkResponse({ type: UserLevel })
    findOne(@Param("userId") userId: string) {
        return this.userLevelService.findOneByUserIdOrFail(userId);
    }
}
