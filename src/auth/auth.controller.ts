import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Session } from "./session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "./auth.guard";

/**
 * Supertokens routes are not defined here, only a few util ones we use at GameNode.
 */
@Controller("auth")
@ApiTags("auth")
export class AuthController {
    @Get("logout")
    @UseGuards(AuthGuard)
    @Header("Clear-Site-Data", "*")
    async logout(@Session() session: SessionContainer) {
        await session.revokeSession();
    }
}
