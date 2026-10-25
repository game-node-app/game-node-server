import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { ConnectionCreateDto } from "./dto/connection-create.dto";
import { ConnectionsService } from "./connections.service";
import { EConnectionType } from "./connections.constants";
import { Public } from "../auth/public.decorator";
import { ConnectionAuthInitDto } from "./dto/connection-auth-init.dto";
import { ConnectionAuthCallbackDto } from "./dto/connection-auth-callback.dto";
import { ConnectionSettingsUpdateDto } from "./dto/connection-settings-update.dto";

@Controller("connections")
@ApiTags("connections")
@UseGuards(AuthGuard)
export class ConnectionsController {
    constructor(private readonly connectionsService: ConnectionsService) {}

    @Get()
    @Public()
    async findAvailableConnections() {
        return this.connectionsService.findAvailableConnections();
    }

    @Get("own")
    async findOwn(@Session() session: SessionContainer) {
        return this.connectionsService.findAllByUserId(session.getUserId());
    }

    @Get("own/:type")
    async findOwnByType(
        @Session() session: SessionContainer,
        @Param("type") type: EConnectionType,
    ) {
        return this.connectionsService.findOneByUserIdAndTypeOrFail(
            session.getUserId(),
            type,
        );
    }

    @Get("user/:userId")
    @Public()
    async findAllByUserId(@Param("userId") userId: string) {
        return this.connectionsService.findAllByUserId(userId);
    }

    @Get("user/:userId/:type")
    @Public()
    async findOneByUserIdAndType(
        @Param("userId") userId: string,
        @Param("type") type: EConnectionType,
    ) {
        return this.connectionsService.findOneByUserIdAndTypeOrFail(
            userId,
            type,
        );
    }

    @Post()
    async createOrUpdate(
        @Session() session: SessionContainer,
        @Body() dto: ConnectionCreateDto,
    ) {
        return this.connectionsService.createOrUpdate(session.getUserId(), dto);
    }

    @Post(":type/auth/init")
    async initRedirectAuth(
        @Session() session: SessionContainer,
        @Param("type") type: EConnectionType,
        @Body() dto: ConnectionAuthInitDto,
    ) {
        return this.connectionsService.initRedirectAuth(
            session.getUserId(),
            type,
            dto,
        );
    }

    @Post(":type/auth/callback")
    async completeRedirectAuth(
        @Session() session: SessionContainer,
        @Param("type") type: EConnectionType,
        @Body() dto: ConnectionAuthCallbackDto,
    ) {
        return this.connectionsService.completeRedirectAuth(
            session.getUserId(),
            type,
            dto,
        );
    }

    @Patch(":id")
    async updateSettings(
        @Session() session: SessionContainer,
        @Param("id", ParseIntPipe) connectionId: number,
        @Body() dto: ConnectionSettingsUpdateDto,
    ) {
        return this.connectionsService.updateSettings(
            session.getUserId(),
            connectionId,
            dto,
        );
    }

    @Patch("own/:type/settings")
    async updateOwnSettings(
        @Session() session: SessionContainer,
        @Param("type") type: EConnectionType,
        @Body() dto: ConnectionSettingsUpdateDto,
    ) {
        const userId = session.getUserId();
        const connection =
            await this.connectionsService.findOneByUserIdAndTypeOrFail(
                userId,
                type,
            );
        return this.connectionsService.updateSettings(
            userId,
            connection.id,
            dto,
        );
    }

    @Delete(":id")
    async delete(
        @Session() session: SessionContainer,
        @Param("id", ParseIntPipe) connectionId: number,
    ) {
        return this.connectionsService.delete(
            session.getUserId(),
            connectionId,
        );
    }
}
