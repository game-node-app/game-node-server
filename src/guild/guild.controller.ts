import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session, SessionContainer } from "../auth/session.decorator";
import { GuildAccessResponseDto } from "./dto/guild-access.dto";
import {
    GetGuildBoardQueryDto,
    GuildBoardResponseDto,
} from "./dto/guild-board.dto";
import {
    AcceptGuildContractDto,
    AcceptGuildContractResponseDto,
    ClaimGuildContractResponseDto,
    GetGuildContractsQueryDto,
    GuildContractDto,
    GuildContractsListResponseDto,
    GuildOverviewResponseDto,
} from "./dto/guild-contracts.dto";
import { GuildBoardSeenResponseDto } from "./dto/guild-profile.dto";
import {
    GuildCosmeticsResponseDto,
    GuildRewardsResponseDto,
    UpdateGuildCosmeticsDto,
} from "./dto/guild-rewards.dto";
import { BypassGuildAccess, GuildAccessGuard } from "./guild-access.guard";
import { GuildAccessService } from "./guild-access.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildContractsService } from "./guild-contracts.service";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRewardsService } from "./guild-rewards.service";

@Controller("guild")
@ApiTags("guild")
@UseGuards(AuthGuard, GuildAccessGuard)
export class GuildController {
    constructor(
        private readonly guildAccessService: GuildAccessService,
        private readonly guildContractsService: GuildContractsService,
        private readonly guildBoardService: GuildBoardService,
        private readonly guildProfileService: GuildProfileService,
        private readonly guildRewardsService: GuildRewardsService,
    ) {}

    @Get("access")
    @Public()
    @BypassGuildAccess()
    @ApiOkResponse({ type: GuildAccessResponseDto })
    getAccess(@Session() session?: SessionContainer) {
        return this.guildAccessService.getAccessStatus(session);
    }

    @Get()
    @ApiOkResponse({ type: GuildOverviewResponseDto })
    getOverview(@Session() session: SessionContainer) {
        return this.guildContractsService.getOverview(session.getUserId());
    }

    @Get("board")
    @ApiOkResponse({ type: GuildBoardResponseDto })
    async getBoard(
        @Session() session: SessionContainer,
        @Query() query: GetGuildBoardQueryDto,
    ) {
        const userId = session.getUserId();
        await this.guildProfileService.ensureProfile(userId);
        return this.guildBoardService.getBoard(userId, { quick: query.quick });
    }

    @Post("board/seen")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: GuildBoardSeenResponseDto })
    markBoardSeen(@Session() session: SessionContainer) {
        return this.guildProfileService.markBoardSeen(session.getUserId());
    }

    @Get("contracts")
    @ApiOkResponse({ type: GuildContractsListResponseDto })
    listContracts(
        @Session() session: SessionContainer,
        @Query() query: GetGuildContractsQueryDto,
    ) {
        return this.guildContractsService.listContracts(
            session.getUserId(),
            query,
        );
    }

    @Post("contracts")
    @ApiCreatedResponse({ type: AcceptGuildContractResponseDto })
    acceptContract(
        @Session() session: SessionContainer,
        @Body() dto: AcceptGuildContractDto,
    ) {
        return this.guildContractsService.acceptContract(
            session.getUserId(),
            dto,
        );
    }

    @Post("contracts/:id/claim")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: ClaimGuildContractResponseDto })
    claimContract(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return this.guildContractsService.claimContract(
            session.getUserId(),
            id,
        );
    }

    @Post("contracts/:id/abandon")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: GuildContractDto })
    abandonContract(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return this.guildContractsService.abandonContract(
            session.getUserId(),
            id,
        );
    }

    @Get("rewards")
    @ApiOkResponse({ type: GuildRewardsResponseDto })
    async getRewards(@Session() session: SessionContainer) {
        const userId = session.getUserId();
        await this.guildProfileService.ensureProfile(userId);
        return this.guildRewardsService.getUserRewards(userId);
    }

    @Patch("cosmetics")
    @ApiOkResponse({ type: GuildCosmeticsResponseDto })
    async updateCosmetics(
        @Session() session: SessionContainer,
        @Body() dto: UpdateGuildCosmeticsDto,
    ) {
        const userId = session.getUserId();
        await this.guildProfileService.ensureProfile(userId);
        return this.guildRewardsService.updateCosmetics(userId, dto);
    }
}
