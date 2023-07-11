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

    @Get()
    @HttpCode(200)
    @CacheTTL(300)
    async find(@Query() dto: FindIgdbDto): Promise<GameMetadata[]> {
        return await this.igdbService.find(dto);
    }

    /**
     * A post request allows us to easily send the array of ids in the body, making it easier for some API clients (like Imsomnia).
     * Since CacheManager doesn't work with anything non-GET, the cache is handled internally in the service.
     * @param dto
     */
    @Post(":igdbIds")
    @HttpCode(200)
    @CacheTTL(120)
    async findByIds(@Param() dto: FindIgdbIdDto) {
        return await this.igdbService.findByIds(dto);
    }
}
