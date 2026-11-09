import {
    Body,
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    Req,
    UseInterceptors,
} from "@nestjs/common";
import type { Request } from "express";
import { GameRepositoryService } from "./game-repository.service";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { GameResource } from "./entities/base/game-resource.entity";
import {
    FindGamesByCollectionTypeRequestDto,
    FindGamesByCollectionTypeResponseDto,
    GameRepositoryCollectionType,
} from "./dto/game-repository-collection.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { AuthService } from "../../auth/auth.service";
import { GameCoverService } from "../game-cover/game-cover.service";

@Controller("game/repository")
@ApiTags("game-repository")
export class GameRepositoryController {
    constructor(
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly gameCoverService: GameCoverService,
        private readonly authService: AuthService,
    ) {}

    @Get("resource")
    async getResource(@Query("resourceName") resourceName: string) {
        return await this.gameRepositoryService.getResource(
            resourceName as keyof GameResource,
        );
    }

    @Post("collection")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindGamesByCollectionTypeResponseDto,
    })
    async getGameIdsByCollectionType(
        @Body() dto: FindGamesByCollectionTypeRequestDto,
    ) {
        return await this.gameRepositoryService.findGamesByCollectionType(dto);
    }

    @Get(":id/platforms/icon")
    @HttpCode(200)
    getIconNamesForPlatformAbbreviations(@Param("id") gameId: number) {
        return this.gameRepositoryService.getIconsNamesForPlatforms(gameId);
    }

    /**
     * TODO: Move this endpoint to {@link ExternalGameService}
     * @param gameId
     */
    @Get(":id/external-stores")
    @HttpCode(200)
    getExternalStoresForGameId(@Param("id") gameId: number) {
        return this.gameRepositoryService.findGameExternalStores(gameId);
    }

    @Post(":id")
    @HttpCode(200)
    async findOneById(
        @Param("id") id: number,
        @Req() req: Request,
        @Body() dto?: GameRepositoryFindOneDto,
    ) {
        // Only the game and relations reach the cached method, so cache keys stay unchanged.
        const { personalizeCovers, coverOwnerUserId, ...cachedDto } = dto ?? {};
        const game = await this.gameRepositoryService.findOneByIdOrFail(
            id,
            dto ? cachedDto : undefined,
        );

        if (!dto || !this.shouldPersonalize(dto)) return game;

        return (
            await this.gameCoverService.applyEffectiveCovers(
                [game],
                await this.findViewerUserId(req),
                coverOwnerUserId,
            )
        )[0];
    }

    @Post()
    @HttpCode(200)
    async findAllByIds(
        @Body() dto: GameRepositoryFindAllDto,
        @Req() req: Request,
    ) {
        // Keep the existing invalid-query behavior when the body is missing.
        if (!dto) return await this.gameRepositoryService.findAllByIds(dto);

        // Only the game ids and relations reach the cached method, so cache keys stay unchanged.
        const { personalizeCovers, coverOwnerUserId, ...cachedDto } = dto;
        const games = await this.gameRepositoryService.findAllByIds(cachedDto);

        if (!this.shouldPersonalize(dto)) return games;

        return await this.gameCoverService.applyEffectiveCovers(
            games,
            await this.findViewerUserId(req),
            coverOwnerUserId,
        );
    }

    private shouldPersonalize(
        dto: GameRepositoryFindAllDto | GameRepositoryFindOneDto,
    ): boolean {
        return (
            !!(dto.personalizeCovers || dto.coverOwnerUserId) &&
            !!dto.relations?.cover
        );
    }

    /** These routes have no AuthGuard: an invalid or missing session is anonymous, never an error. */
    private async findViewerUserId(req: Request): Promise<string | undefined> {
        try {
            return (await this.authService.getSession(req))?.user.id;
        } catch {
            return undefined;
        }
    }
}
