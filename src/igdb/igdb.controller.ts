import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Query,
    HttpCode,
    UseInterceptors,
} from "@nestjs/common";
import { IgdbService } from "./igdb.service";
import { FindIgdbDto } from "./dto/find-igdb.dto";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { GameMetadata } from "../utils/game-metadata.dto";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { FindIgdbIdDto } from "./dto/find-igdb-id.dto";

@Controller("igdb")
@ApiTags("igdb")
@UseInterceptors(CacheInterceptor)
export class IgdbController {
    constructor(private readonly igdbService: IgdbService) {}

    @Post()
    @HttpCode(200)
    @CacheTTL(300)
    async find(@Body() dto: FindIgdbDto): Promise<GameMetadata[]> {
        return await this.igdbService.find(dto);
    }

    @Post("ids")
    @HttpCode(200)
    @CacheTTL(60)
    async findByIds(@Body() dto: FindIgdbIdDto) {
        return await this.igdbService.findByIds(dto);
    }
}
