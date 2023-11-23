import {
    Controller,
    Post,
    Body,
    Param,
    UseGuards,
    HttpCode,
    Get,
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

    @Get()
    @HttpCode(200)
    @ApiProduces("application/json")
    @ApiResponse({
        type: Library,
        status: 200,
    })
    async findOwn(@Session() session: SessionContainer): Promise<Library> {
        const library = await this.librariesService.findOneById(
            session.getUserId(),
            true,
            {
                collections: true,
            },
        );
        return library!;
    }

    @Get(":id")
    @Public()
    async findOneByIdWithPermissions(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return this.librariesService.findOneByIdWithPermissions(
            session.getUserId(),
            id,
        );
    }
}
