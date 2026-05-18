import {
    Controller,
    Delete,
    Get,
    Header,
    Param,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Session } from "./session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";

/**
 * Supertokens routes are not defined here, only a few util ones we use at GameNode.
 */
@Controller("auth")
@ApiTags("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get("logout")
    @UseGuards(AuthGuard)
    @Header("Clear-Site-Data", "*")
    async logout(@Session() session: SessionContainer) {
        await session.revokeSession();
    }

    @Get("providers")
    @UseGuards(AuthGuard)
    @ApiOkResponse({ description: "List of linked providers" })
    async getLinkedProviders(@Session() session: SessionContainer) {
        return this.authService.getLinkedProviders(session.getUserId());
    }

    @Delete("providers/:providerId")
    @UseGuards(AuthGuard)
    @ApiResponse({
        status: 400,
        description: "Cannot unlink last provider or provider not linked",
    })
    async unlinkProvider(
        @Session() session: SessionContainer,
        @Param("providerId") providerId: string,
    ) {
        await this.authService.unlinkProvider(session.getUserId(), providerId);
    }
}
