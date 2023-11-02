import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    HttpCode,
    Query,
} from "@nestjs/common";
import { LibrariesService } from "./libraries.service";
import { AuthGuard } from "../auth/auth.guard";
import { ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";
import { Library } from "./entities/library.entity";
import { GetLibraryDto } from "./dto/get-library.dto";
import { Public } from "../auth/public.decorator";

@Controller("libraries")
@UseGuards(AuthGuard)
@ApiTags("libraries")
export class LibrariesController {
    constructor(private readonly librariesService: LibrariesService) {}

    @Post()
    @HttpCode(200)
    @ApiProduces("application/json")
    @ApiResponse({
        type: Library,
        status: 200,
    })
    async findOwn(
        @Session() session: SessionContainer,
        @Body() dto: GetLibraryDto,
    ): Promise<Library> {
        const library = await this.librariesService.findOneById(
            session.getUserId(),
            true,
            dto,
        );
        return library!;
    }

    @Post(":id")
    @Public()
    async findOneByIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("id") id: string,
        @Body() dto: GetLibraryDto,
    ) {
        return this.librariesService.findOneByIdWithPermissions(
            session.getUserId(),
            id,
            dto,
        );
    }
}
