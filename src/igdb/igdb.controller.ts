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
import { IGDBResponse } from "./igdb.types";
import { TPaginationData } from "../utils/buildPaginationResponse";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";

@Controller("igdb")
@ApiTags("igdb")
@UseInterceptors(CacheInterceptor)
export class IgdbController {
    constructor(private readonly igdbService: IgdbService) {}

    @Get()
    @HttpCode(200)
    @UseInterceptors(new PaginationInterceptor())
    @CacheTTL(600)
    async find(
        @Query() dto: FindIgdbDto,
    ): Promise<TPaginationData<GameMetadata>> {
        return await this.igdbService.findOrFail(dto);
    }

    @Get("ids")
    @HttpCode(200)
    @UseInterceptors(new PaginationInterceptor())
    @CacheTTL(300)
    async findByIds(
        @Query() dto: FindIgdbIdDto,
    ): Promise<TPaginationData<GameMetadata>> {
        return await this.igdbService.findByIdsOrFail(dto);
    }
}
