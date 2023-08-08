import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
} from "@nestjs/common";
import { LibrariesService } from "./libraries.service";
import { AuthGuard } from "../auth/auth.guard";
import { ApiTags } from "@nestjs/swagger";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";

@Controller("libraries")
@UseGuards(new AuthGuard())
@ApiTags("libraries")
export class LibrariesController {
    constructor(private readonly librariesService: LibrariesService) {}

    @Get()
    async findByUserId(@Session() session: SessionContainer) {
        return this.librariesService.findOneById(session.getUserId(), true);
    }

    @Get(":id")
    async findById(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return this.librariesService.findOneByIdWithPermissions(
            session.getUserId(),
            id,
        );
    }
}
