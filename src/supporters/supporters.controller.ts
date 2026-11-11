import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { buildPaginationResponse } from "../utils/pagination/buildPaginationResponse";
import { GetSupportersQueryDto } from "./dto/get-supporters-query.dto";
import { PaginatedSupportersResponseDto } from "./dto/supporters-wall.dto";
import { SupportersService } from "./supporters.service";

@Controller("supporters")
@ApiTags("supporters")
export class SupportersController {
    constructor(private readonly supportersService: SupportersService) {}

    /**
     * Built here instead of PaginationInterceptor: that interceptor falls back
     * to 10 when `limit` is omitted, which would contradict this wall's default.
     */
    @Get()
    @ApiOkResponse({ type: PaginatedSupportersResponseDto })
    async getWall(@Query() query: GetSupportersQueryDto) {
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 20;
        return buildPaginationResponse(
            await this.supportersService.getWall(offset, limit),
            { offset, limit },
        );
    }
}
