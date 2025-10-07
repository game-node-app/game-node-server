import { Controller, Delete, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../../auth/session.decorator";
import { UserAccountService } from "./user-account.service";
import { ApiTags } from "@nestjs/swagger";

@Controller("user/account")
@ApiTags("user-account")
@UseGuards(AuthGuard)
export class UserAccountController {
    constructor(private readonly userAccountService: UserAccountService) {}

    @Delete("restart")
    async restartUserAccount(@Session() session: SessionContainer) {
        await this.userAccountService.restartUserAccount(session.getUserId());
    }
}
