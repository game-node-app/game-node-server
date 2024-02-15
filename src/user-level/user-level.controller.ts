import { Controller, Get, Param } from "@nestjs/common";
import { UserLevelService } from "./user-level.service";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { UserLevel } from "./entities/user-level.entity";

@Controller("user/user-level")
@ApiTags("level")
export class UserLevelController {
    constructor(private readonly userLevelService: UserLevelService) {}

    @Get(":userId")
    @ApiOkResponse({ status: 200, type: UserLevel })
    findOne(@Param("userId") userId: string) {
        return this.userLevelService.findOneByUserIdOrFail(userId);
    }
}
