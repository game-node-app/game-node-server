import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { PreferredPlatformService } from "./preferred-platform.service";
import { CreatePreferredPlatformDto } from "./dto/create-preferred-platform.dto";
import { UpdatePreferredPlatformOrderDto } from "./dto/update-preferred-platform-order.dto";

@Controller("preferred-platform")
@ApiTags("preferred-platform")
@UseGuards(AuthGuard)
export class PreferredPlatformController {
    constructor(
        private readonly preferredPlatformService: PreferredPlatformService,
    ) {}

    @Get()
    async findAllByUserId(@Session() session: SessionContainer) {
        return this.preferredPlatformService.findAllByUserId(
            session.getUserId(),
        );
    }

    @Post()
    async createOrUpdate(
        @Session() session: SessionContainer,
        @Body() dto: CreatePreferredPlatformDto,
    ) {
        return this.preferredPlatformService.createOrUpdate(
            session.getUserId(),
            dto,
        );
    }

    @Delete(":platformId")
    async deletePreferredPlatform(
        @Session() session: SessionContainer,
        @Param("platformId") platformId: number,
    ) {
        return this.preferredPlatformService.delete(
            session.getUserId(),
            platformId,
        );
    }
}
