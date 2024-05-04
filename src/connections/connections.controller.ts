import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
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

@Controller("connections")
@ApiTags("connections")
@UseGuards(AuthGuard)
export class ConnectionsController {
    constructor(private readonly connectionsService: ConnectionsService) {}

    @Get(":type")
    async findOwnByType(
        @Session() session: SessionContainer,
        @Param("type") type: EConnectionType,
    ) {
        return this.connectionsService.findOneByUserIdAndTypeOrFail(
            session.getUserId(),
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

    @Delete(":id")
    async delete(
        @Session() session: SessionContainer,
        @Param("id") connectionId: number,
    ) {
        return this.connectionsService.delete(
            session.getUserId(),
            connectionId,
        );
    }
}
