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
    RerollGuildBoardEntryResponseDto,
} from "./dto/guild-board.dto";
import {
    ClaimGuildBountyResponseDto,
    GetGuildBountiesQueryDto,
    GuildBountiesResponseDto,
} from "./dto/guild-bounties.dto";
import {
    AdvanceGuildChainDto,
    GuildChainActionResponseDto,
    GuildChainsResponseDto,
    StartGuildChainDto,
} from "./dto/guild-chains.dto";
import {
    AcceptGuildContractDto,
    AcceptGuildContractResponseDto,
    ClaimGuildContractResponseDto,
    ExtendGuildContractResponseDto,
    GetGuildContractsQueryDto,
    GuildContractDto,
    GuildContractsListResponseDto,
    GuildOverviewResponseDto,
} from "./dto/guild-contracts.dto";
import {
    GuildEmporiumPurchaseResponseDto,
    GuildEmporiumResponseDto,
    GuildExtraSlotPermitStatusDto,
    PurchaseGuildEmporiumItemDto,
} from "./dto/guild-emporium.dto";
import {
    ClaimGuildPassportMilestoneResponseDto,
    GuildPassportResponseDto,
} from "./dto/guild-passport.dto";
import { GuildBoardSeenResponseDto } from "./dto/guild-profile.dto";
import {
    GuildCosmeticsResponseDto,
    GuildRewardsResponseDto,
    UpdateGuildCosmeticsDto,
} from "./dto/guild-rewards.dto";
import { GuildChainKey } from "./guild.constants";
import { BypassGuildAccess, GuildAccessGuard } from "./guild-access.guard";
import { GuildAccessService } from "./guild-access.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildBountiesService } from "./guild-bounties.service";
import { GuildChainsService } from "./guild-chains.service";
import { GuildContractsService } from "./guild-contracts.service";
import { GuildEmporiumService } from "./guild-emporium.service";
import { GuildPassportService } from "./guild-passport.service";
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
        private readonly guildEmporiumService: GuildEmporiumService,
        private readonly guildPassportService: GuildPassportService,
        private readonly guildChainsService: GuildChainsService,
        private readonly guildBountiesService: GuildBountiesService,
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

    @Post("board/:entryId/reroll")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: RerollGuildBoardEntryResponseDto })
    rerollBoardEntry(
        @Session() session: SessionContainer,
        @Param("entryId") entryId: string,
    ) {
        return this.guildBoardService.rerollEntry(session.getUserId(), entryId);
    }

    @Post("contracts/:id/extend")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: ExtendGuildContractResponseDto })
    extendContract(
        @Session() session: SessionContainer,
        @Param("id") id: string,
    ) {
        return this.guildContractsService.extendContract(
            session.getUserId(),
            id,
        );
    }

    @Get("emporium")
    @ApiOkResponse({ type: GuildEmporiumResponseDto })
    getEmporium(@Session() session: SessionContainer) {
        return this.guildEmporiumService.getEmporium(session.getUserId());
    }

    @Post("emporium/purchase")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: GuildEmporiumPurchaseResponseDto })
    purchaseEmporiumItem(
        @Session() session: SessionContainer,
        @Body() dto: PurchaseGuildEmporiumItemDto,
    ) {
        return this.guildEmporiumService.purchase(session.getUserId(), dto);
    }

    @Post("consumables/extra_slot_permit/activate")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: GuildExtraSlotPermitStatusDto })
    activateExtraSlotPermit(@Session() session: SessionContainer) {
        return this.guildEmporiumService.activateExtraSlotPermit(
            session.getUserId(),
        );
    }

    @Get("passport")
    @ApiOkResponse({ type: GuildPassportResponseDto })
    getPassport(@Session() session: SessionContainer) {
        return this.guildPassportService.getPassport(session.getUserId());
    }

    @Post("passport/claim/:milestone")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: ClaimGuildPassportMilestoneResponseDto })
    claimPassportMilestone(
        @Session() session: SessionContainer,
        @Param("milestone") milestone: string,
    ) {
        return this.guildPassportService.claimMilestone(
            session.getUserId(),
            Number.parseInt(milestone, 10),
        );
    }

    @Get("chains")
    @ApiOkResponse({ type: GuildChainsResponseDto })
    listChains(@Session() session: SessionContainer) {
        return this.guildChainsService.listChains(session.getUserId());
    }

    @Post("chains/:chainKey/start")
    @ApiCreatedResponse({ type: GuildChainActionResponseDto })
    startChain(
        @Session() session: SessionContainer,
        @Param("chainKey") chainKey: string,
        @Body() dto: StartGuildChainDto,
    ) {
        return this.guildChainsService.startChain(
            session.getUserId(),
            chainKey as GuildChainKey,
            dto ?? {},
        );
    }

    @Post("chains/:chainKey/advance")
    @ApiCreatedResponse({ type: GuildChainActionResponseDto })
    advanceChain(
        @Session() session: SessionContainer,
        @Param("chainKey") chainKey: string,
        @Body() dto: AdvanceGuildChainDto,
    ) {
        return this.guildChainsService.advanceChain(
            session.getUserId(),
            chainKey as GuildChainKey,
            dto,
        );
    }

    @Get("bounties")
    @ApiOkResponse({ type: GuildBountiesResponseDto })
    listBounties(
        @Session() session: SessionContainer,
        @Query() query: GetGuildBountiesQueryDto,
    ) {
        return this.guildBountiesService.listBounties(
            session.getUserId(),
            query.locale,
        );
    }

    @Post("bounties/:id/claim")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: ClaimGuildBountyResponseDto })
    claimBounty(@Session() session: SessionContainer, @Param("id") id: string) {
        return this.guildBountiesService.claimBounty(session.getUserId(), id);
    }
}
