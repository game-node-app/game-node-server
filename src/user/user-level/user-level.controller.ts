import { Controller, Get, Param } from "@nestjs/common";
import { UserLevelService } from "./user-level.service";

@Controller("user/level")
export class UserLevelController {
    constructor(private readonly userLevelService: UserLevelService) {}

    @Get(":userId")
    findOne(@Param("id") userId: string) {
        return this.userLevelService.findOneByUserId(userId);
    }
}
