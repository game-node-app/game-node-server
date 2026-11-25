import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { LevelService } from "../level/level.service";
import { GuildChainClaimProgressDto } from "./dto/guild-chains.dto";
import {
    AcceptGuildContractDto,
    AcceptGuildContractResponseDto,
    ClaimGuildContractResponseDto,
    ExtendGuildContractResponseDto,
    GetGuildContractsQueryDto,
    GuildContractDto,
    GuildContractEventSummaryDto,
    GuildContractPlaytimeProgressDto,
    GuildContractTargetGameDto,
    GuildContractsListResponseDto,
    GuildOverviewResponseDto,
} from "./dto/guild-contracts.dto";
import { GuildBoardEntry } from "./entities/guild-board-entry.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import {
    ANCIENT_FOSSIL_DAYS,
    computeGuildRank,
    currentMonthKey,
    currentWeekStart,
    DAY_MS,
    defaultSealsForRank,
    GUILD_GLOBAL_XP_MULTIPLIER,
    GuildBoardCycle,
    GuildCategory,
    GuildConsumableKey,
    GuildContractStatus,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRank,
    GuildSealReason,
    getGuildRankPerks,
    igdbImageUrl,
    LinaPose,
    LinaTrigger,
    nextMondayRefreshAt,
    RECENT_DUST_DAYS,
    STALE_BACKLOG_DAYS,
    toRewardDescriptor,
} from "./guild.constants";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildBountiesService } from "./guild-bounties.service";
import {
    GuildChainsService,
    resolveActiveContractLimit,
} from "./guild-chains.service";
import { GuildPassportService } from "./guild-passport.service";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRankProgressionService } from "./guild-rank-progression.service";
import { GuildRewardsService } from "./guild-rewards.service";
import { GuildSealsService } from "./guild-seals.service";
import { GUILD_SYSTEM_TEMPLATES } from "./guild-templates.constants";
import {
    GuildTimeToBeatService,
    getEffectiveTtbSeconds,
} from "./guild-time-to-beat.service";
import { LinaReceptionService } from "./lina-reception.service";
import { evaluateGuildBonusObjective } from "./evaluators";
import { gameMatchesGuildCriteria } from "./evaluators/game-criteria";

const CONTRACT_RELATIONS = {
    targetGame: true,
    reward: true,
    event: { translations: true },
} as const;

const rankOrder = (status: GuildContractStatus) =>
    status === GuildContractStatus.READY_TO_CLAIM ? 0 : 1;

/** `GuildProceduralBoardService`'s veteran-library threshold for `ancient_fossil`. */
const VETERAN_LIBRARY_DAYS = 730;

/**
 * Player-facing contract lifecycle: acceptance with target validation,
 * listing, atomic turn-in and abandonment (designs 5 and 6).
 */
@Injectable()
export class GuildContractsService {
    private readonly logger = new Logger(GuildContractsService.name);
    private readonly sealsService: GuildSealsService;
    private readonly rankProgressionService: GuildRankProgressionService;
    private readonly passportService: GuildPassportService;
    private readonly chainsService: GuildChainsService;

    constructor(
        private readonly dataSource: DataSource,
        private readonly guildProfileService: GuildProfileService,
        private readonly guildBoardService: GuildBoardService,
        private readonly guildRewardsService: GuildRewardsService,
        private readonly evaluatorService: GuildContractEvaluatorService,
        private readonly linaReceptionService: LinaReceptionService,
        private readonly levelService: LevelService,
        private readonly achievementsProgressService: AchievementsProgressService,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
        @Optional() sealsService?: GuildSealsService,
        @Optional() rankProgressionService?: GuildRankProgressionService,
        @Optional() passportService?: GuildPassportService,
        @Optional() chainsService?: GuildChainsService,
        @Optional()
        private readonly guildBountiesService?: GuildBountiesService,
    ) {
        // Optional until Wave 5 registers the economy services in GuildModule.
        this.sealsService = sealsService ?? new GuildSealsService(dataSource);
        this.rankProgressionService =
            rankProgressionService ??
            new GuildRankProgressionService(dataSource, guildRewardsService);
        this.passportService =
            passportService ??
            new GuildPassportService(
                dataSource,
                guildRewardsService,
                this.sealsService,
                this.rankProgressionService,
                levelService,
            );
        this.chainsService =
            chainsService ??
            new GuildChainsService(
                dataSource,
                this.sealsService,
                guildTimeToBeatService,
            );
    }

    public async getOverview(
        userId: string,
        now = new Date(),
    ): Promise<GuildOverviewResponseDto> {
        const guildProfile =
            await this.guildProfileService.ensureProfile(userId);
        await this.evaluatorService.evaluateUserContracts(userId, now);

        const weekStart = currentWeekStart(now);
        const [
            license,
            contracts,
            yearGoal,
            boardCount,
            completedCount,
            passport,
            activeChain,
            bountySummary,
        ] = await Promise.all([
            this.guildProfileService.getLicense(userId, guildProfile, now),
            this.contractRepository().find({
                where: {
                    profileUserId: userId,
                    status: In([
                        GuildContractStatus.ACTIVE,
                        GuildContractStatus.READY_TO_CLAIM,
                    ]),
                },
                relations: CONTRACT_RELATIONS,
            }),
            this.guildProfileService.getCurrentYearGoal(userId, now),
            this.guildBoardService.getOpenBoardCount(userId, now),
            this.contractRepository().count({
                where: {
                    profileUserId: userId,
                    status: GuildContractStatus.COMPLETED,
                },
            }),
            this.passportService.getPassportSummary(userId, now),
            this.chainsService.getActiveChainSummary(userId),
            this.guildBountiesService
                ? this.guildBountiesService.getBountiesSummary(userId, now)
                : Promise.resolve({
                      activeBountiesCount: 0,
                      claimableBountiesCount: 0,
                  }),
        ]);

        contracts.sort(
            (a, b) =>
                rankOrder(a.status) - rankOrder(b.status) ||
                b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
        const activeContracts = await this.enrichContracts(
            userId,
            contracts,
            now,
        );
        const readyContract =
            contracts.find(
                (contract) =>
                    contract.status === GuildContractStatus.READY_TO_CLAIM,
            ) ?? null;
        const lina = await this.linaReceptionService.evaluateReception(
            userId,
            guildProfile,
            {
                readyContract,
                now,
                updateLastVisited: true,
                hasClaimableCommunityBounty:
                    bountySummary.claimableBountiesCount > 0,
            },
        );

        return {
            license,
            activeContracts,
            yearGoal,
            counts: {
                boardCount,
                acceptedCount: contracts.length,
                completedCount,
            },
            weekStart,
            nextRefreshAt: nextMondayRefreshAt(weekStart),
            lina,
            passport,
            activeChain,
            activeBountiesCount: bountySummary.activeBountiesCount,
        };
    }

    public async listContracts(
        userId: string,
        query: GetGuildContractsQueryDto,
        now = new Date(),
    ): Promise<GuildContractsListResponseDto> {
        await this.guildProfileService.ensureProfile(userId);
        await this.evaluatorService.expireOverdueContracts(userId, now);

        const offset = query.offset ?? 0;
        const limit = query.limit ?? 20;
        const tab = query.tab;
        const builder = this.contractRepository()
            .createQueryBuilder("contract")
            .leftJoinAndSelect("contract.targetGame", "targetGame")
            .leftJoinAndSelect("contract.reward", "reward")
            .leftJoinAndSelect("contract.event", "event")
            .leftJoinAndSelect("event.translations", "translation")
            .where("contract.profileUserId = :userId", { userId });

        const pagination = (totalItems: number) => ({
            totalItems,
            totalPages: totalItems > 0 ? Math.ceil(totalItems / limit) : 1,
            hasNextPage: offset + limit < totalItems,
        });

        // At most 3 accepted contracts exist per user, so sorting ready first in memory
        // keeps pagination correct without a raw SQL CASE order.
        if (tab === "accepted") {
            builder
                .andWhere("contract.status IN (:...acceptedStatuses)", {
                    acceptedStatuses: [
                        GuildContractStatus.ACTIVE,
                        GuildContractStatus.READY_TO_CLAIM,
                    ],
                })
                .orderBy("contract.updatedAt", "DESC");
            const all = await builder.getMany();
            all.sort(
                (a, b) =>
                    rankOrder(a.status) - rankOrder(b.status) ||
                    b.updatedAt.getTime() - a.updatedAt.getTime(),
            );

            return {
                data: await this.enrichContracts(
                    userId,
                    all.slice(offset, offset + limit),
                    now,
                ),
                pagination: pagination(all.length),
            };
        }

        if (tab === "completed") {
            builder
                .andWhere("contract.status = :status", {
                    status: GuildContractStatus.COMPLETED,
                })
                .orderBy("contract.updatedAt", "DESC");
        } else if (query.status) {
            builder
                .andWhere("contract.status = :status", {
                    status: query.status,
                })
                .orderBy("contract.updatedAt", "DESC");
        } else {
            builder.orderBy("contract.updatedAt", "DESC");
        }

        const [contracts, totalItems] = await builder
            .skip(offset)
            .take(limit)
            .getManyAndCount();

        return {
            data: await this.enrichContracts(userId, contracts, now),
            pagination: pagination(totalItems),
        };
    }

    public async acceptContract(
        userId: string,
        dto: AcceptGuildContractDto,
        now?: Date,
    ): Promise<AcceptGuildContractResponseDto> {
        if (!!dto.boardEntryId === !!dto.eventId) {
            throw new BadRequestException(
                "Provide exactly one of boardEntryId or eventId.",
            );
        }

        const lookupNow = now ?? new Date();
        const guildProfile =
            await this.guildProfileService.ensureProfile(userId);
        const entry = dto.boardEntryId
            ? await this.loadBoardEntry(userId, dto.boardEntryId)
            : null;
        const preReadEvent = dto.eventId
            ? await this.loadActiveEvent(dto.eventId, lookupNow)
            : null;

        // Warms the TTB cache before the transaction, so the locked accept never
        // reaches IGDB while holding the guild_event row.
        const preReadCriteria = entry?.criteria ?? preReadEvent?.criteria;
        if (
            dto.targetGameId != null &&
            (preReadCriteria?.maxTimeToBeatHours != null ||
                preReadCriteria?.minTimeToBeatHours != null)
        ) {
            await this.guildTimeToBeatService.getForGameIds(
                [dto.targetGameId],
                lookupNow,
            );
        }

        const contractId = randomUUID();
        const acceptedAt = await this.dataSource.transaction(
            async (manager) => {
                // Serializes concurrent accepts of the same user (cap + duplicates).
                const [profileRow] = await manager.query(
                    "SELECT `rank` AS guildRank, extraSlotPermitWeekStart FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
                    [userId],
                );
                // Fixed guild_profile -> guild_event order: admin event writes never lock the profile.
                if (dto.eventId) {
                    await manager.query(
                        "SELECT id FROM guild_event WHERE id = ? FOR UPDATE",
                        [dto.eventId],
                    );
                }
                // Captured after the locks: a finish committed while waiting is pre-acceptance.
                const acceptedAt = now ?? new Date();
                const event = dto.eventId
                    ? await this.loadActiveEvent(
                          dto.eventId,
                          acceptedAt,
                          manager,
                      )
                    : null;
                if (entry) {
                    if (entry.cycle === GuildBoardCycle.MONTHLY) {
                        // Expeditions stay acceptable until the next São Paulo month.
                        if (
                            entry.periodKey !== currentMonthKey(acceptedAt) ||
                            acceptedAt >= entry.expiresAt
                        ) {
                            throw new BadRequestException(
                                "This board quest is no longer available.",
                            );
                        }
                    } else if (
                        entry.weekStart !== currentWeekStart(acceptedAt)
                    ) {
                        throw new BadRequestException(
                            "This board quest is no longer available.",
                        );
                    }
                }
                await this.assertTargetGame(
                    userId,
                    entry,
                    event,
                    dto.targetGameId,
                    acceptedAt,
                    manager,
                );
                await this.evaluatorService.expireOverdueWithManager(
                    manager,
                    userId,
                    acceptedAt,
                );

                const [countRow] = await manager.query(
                    "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ? AND status IN (?, ?)",
                    [
                        userId,
                        GuildContractStatus.ACTIVE,
                        GuildContractStatus.READY_TO_CLAIM,
                    ],
                );
                const activeLimit = resolveActiveContractLimit(
                    profileRow?.guildRank ?? guildProfile.rank,
                    profileRow?.extraSlotPermitWeekStart ?? null,
                    currentWeekStart(acceptedAt),
                );
                if (Number(countRow.total) >= activeLimit) {
                    throw new ConflictException({
                        message: `You already hold the maximum of ${activeLimit} active contracts.`,
                        code: "guild_active_contract_limit_reached",
                    });
                }

                const duplicate = await manager
                    .getRepository(GuildContract)
                    .findOne({
                        where: {
                            profileUserId: userId,
                            ...(entry
                                ? { boardEntryId: entry.id }
                                : { eventId: event!.id }),
                            status: In([
                                GuildContractStatus.ACTIVE,
                                GuildContractStatus.READY_TO_CLAIM,
                                GuildContractStatus.COMPLETED,
                            ]),
                        },
                    });
                if (duplicate) {
                    throw new ConflictException({
                        message: "You already accepted this quest.",
                        code: "guild_contract_already_exists",
                    });
                }

                // Snapshot the rules from the event read under lock.
                const template = GUILD_SYSTEM_TEMPLATES.find(
                    (item) => item.key === entry?.templateKey,
                );
                // A board contract runs from acceptance; an event contract ends with the event.
                const durationDays =
                    template?.contractDurationDays ??
                    (entry?.category === GuildCategory.LIBRARY ? 21 : 7);
                const rank = entry?.rank ?? event!.rank;
                await manager.getRepository(GuildContract).insert({
                    id: contractId,
                    profileUserId: userId,
                    boardEntryId: entry?.id ?? null,
                    eventId: event?.id ?? null,
                    category: entry?.category ?? GuildCategory.EVENT,
                    templateKey: entry?.templateKey ?? null,
                    rank,
                    xpReward: entry?.xpReward ?? event!.xpReward,
                    sealsReward: entry
                        ? entry.sealsReward
                        : event!.sealsReward ||
                          defaultSealsForRank(event!.rank),
                    objectiveType: entry?.objectiveType ?? event!.objectiveType,
                    criteria: entry?.criteria ?? event!.criteria,
                    bonusObjective:
                        entry?.bonusObjective ?? event?.bonusObjective ?? null,
                    bonusCompleted: false,
                    extendedCount: 0,
                    targetGameId: dto.targetGameId ?? null,
                    progressCurrent: 0,
                    progressTarget: entry?.targetCount ?? event!.targetCount,
                    status: GuildContractStatus.ACTIVE,
                    rewardId: entry ? entry.rewardId : event!.rewardId,
                    claimPayload: null,
                    acceptedAt,
                    readyAt: null,
                    claimedAt: null,
                    expiresAt: entry
                        ? new Date(acceptedAt.getTime() + durationDays * DAY_MS)
                        : event!.endsAt,
                });
                return acceptedAt;
            },
        );

        const contract = await this.findContractOrFail(userId, contractId);
        const [contractDto] = await this.enrichContracts(
            userId,
            [contract],
            acceptedAt,
        );
        const hasUnseenBoard =
            await this.linaReceptionService.computeHasUnseenBoard(
                guildProfile,
                acceptedAt,
            );
        const lina = {
            trigger: LinaTrigger.CONTRACT_ACCEPTED,
            pose: LinaPose.HAPPY,
            context: {
                contractId: contract.id,
                category: contract.category,
                templateKey: contract.templateKey,
                eventId: contract.eventId,
                targetGameId: contractDto.targetGameId,
                ...(contractDto.targetGame?.name
                    ? { targetGameName: contractDto.targetGame.name }
                    : {}),
            },
            hasUnseenBoard,
        };

        return { contract: contractDto, lina };
    }

    public async claimContract(
        userId: string,
        contractId: string,
        now = new Date(),
    ): Promise<ClaimGuildContractResponseDto> {
        const outcome = await this.dataSource.transaction(async (manager) => {
            const rows: Array<{
                id: string;
                status: GuildContractStatus;
                chainProgressId: string | null;
            }> = await manager.query(
                "SELECT id, status, chainProgressId FROM guild_contract WHERE id = ? AND profileUserId = ? FOR UPDATE",
                [contractId, userId],
            );
            const locked = rows[0];
            if (!locked) {
                throw new NotFoundException("Contract not found.");
            }
            if (locked.status !== GuildContractStatus.READY_TO_CLAIM) {
                throw new ConflictException({
                    message: "This contract is not ready to claim.",
                    code: "guild_contract_not_ready",
                });
            }

            // Design 6 lock order: contract -> chain -> profile.
            if (locked.chainProgressId) {
                await manager.query(
                    "SELECT id FROM guild_user_chain WHERE id = ? FOR UPDATE",
                    [locked.chainProgressId],
                );
            }
            await manager.query(
                "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
                [userId],
            );
            const guildProfile = await manager
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId });
            const contract = await manager
                .getRepository(GuildContract)
                .findOneOrFail({
                    where: { id: contractId },
                    relations: CONTRACT_RELATIONS,
                });

            const { bonusCompleted, creditedCollectionIds } =
                await this.recheckClaimObjectives(manager, contract, now);

            const fulfillment =
                await this.guildRewardsService.fulfillContractRewardWithManager(
                    manager,
                    userId,
                    contract.id,
                    contract.rewardId,
                    now,
                    {
                        upgradeChestTier:
                            bonusCompleted &&
                            contract.bonusObjective?.upgradeChestTier === true,
                    },
                );

            const sealsReward = contract.sealsReward ?? 0;
            const bonusSeals = bonusCompleted
                ? (contract.bonusObjective?.bonusSeals ?? 0)
                : 0;
            if (sealsReward > 0) {
                await this.sealsService.creditSealsWithManager(
                    manager,
                    userId,
                    sealsReward,
                    GuildSealReason.CONTRACT_CLAIM,
                    contract.id,
                );
            }
            if (bonusSeals > 0) {
                await this.sealsService.creditSealsWithManager(
                    manager,
                    userId,
                    bonusSeals,
                    GuildSealReason.BONUS_OBJECTIVE,
                    contract.id,
                );
            }

            const bonusXp = bonusCompleted
                ? (contract.bonusObjective?.bonusXp ?? 0)
                : 0;
            const totalXp = contract.xpReward + bonusXp + fulfillment.bonusXp;
            const globalXpAwarded = Math.floor(
                totalXp * GUILD_GLOBAL_XP_MULTIPLIER,
            );
            const rankBefore = guildProfile.rank;
            const xpAfter = guildProfile.xp + totalXp;
            const rankAfter = computeGuildRank(xpAfter).rank;

            await manager.update(
                GuildProfile,
                { profileUserId: userId },
                { xp: xpAfter, rank: rankAfter },
            );
            if (globalXpAwarded > 0) {
                await this.levelService.increaseExp(
                    userId,
                    globalXpAwarded,
                    manager,
                );
            }

            const updatedProfile = await manager
                .getRepository(GuildProfile)
                .findOneByOrFail({ profileUserId: userId });
            const promotion =
                await this.rankProgressionService.grantRankPromotionsWithManager(
                    manager,
                    updatedProfile,
                    contract.id,
                    now,
                );
            const prestige =
                await this.rankProgressionService.grantPrestigeStarsWithManager(
                    manager,
                    updatedProfile,
                    contract.id,
                    now,
                );
            const passportMonth =
                await this.passportService.recordContractCompletionWithManager(
                    manager,
                    userId,
                    now,
                );
            const chainProgress =
                await this.chainsService.onChainContractClaimedWithManager(
                    manager,
                    userId,
                    contract,
                    now,
                );

            // `fulfillment.bonusSeals` was already credited (chest/duplicate) inside
            // the rewards service; sum it into the receipt without crediting it again.
            const sealsAwarded =
                sealsReward +
                bonusSeals +
                fulfillment.bonusSeals +
                prestige.sealsAwarded +
                (chainProgress?.bonusSealsAwarded ?? 0);

            const claimPayload = {
                xpAwarded: totalXp,
                globalXpAwarded,
                rankBefore,
                rankAfter,
                sealsAwarded,
                sealsReward,
                bonusObjective: contract.bonusObjective,
                bonusCompleted,
                extendedCount: contract.extendedCount,
                chainProgressId: contract.chainProgressId,
                creditedCollectionIds,
                unlockedRewards: fulfillment.unlockedRewards,
                chestResult: fulfillment.chestResult,
                promotionRewards: promotion.unlockedRewards,
                prestigeRewards: prestige.chestResults,
                passportMonth,
            };
            await manager.query(
                "UPDATE guild_contract SET status = ?, claimedAt = ?, claimPayload = ?, bonusCompleted = ? WHERE id = ?",
                [
                    GuildContractStatus.COMPLETED,
                    now,
                    JSON.stringify(claimPayload),
                    bonusCompleted,
                    contractId,
                ],
            );

            // The whole receipt is built before committing: a failure must not burn the reward.
            const claimed = await this.findContractOrFail(
                userId,
                contractId,
                manager,
            );
            const [contractDto] = await this.enrichContracts(
                userId,
                [claimed],
                now,
                manager,
            );
            const hasUnseenBoard =
                await this.linaReceptionService.computeHasUnseenBoard(
                    guildProfile,
                    now,
                    manager,
                );

            return {
                totalXp,
                globalXpAwarded,
                rankBefore,
                rankAfter,
                sealsAwarded,
                bonusCompleted,
                unlockedRewards: fulfillment.unlockedRewards,
                chestResult: fulfillment.chestResult,
                promotionRewards: promotion.unlockedRewards,
                prestigeRewards: prestige.chestResults,
                passportMonth,
                chainProgress,
                pendingBadgeActivity: fulfillment.pendingBadgeActivity,
                contractDto,
                hasUnseenBoard,
            };
        });

        if (outcome.pendingBadgeActivity) {
            try {
                this.achievementsProgressService.registerGrantActivity(
                    userId,
                    outcome.pendingBadgeActivity,
                );
            } catch (error) {
                this.logger.error(
                    `Unable to register badge activity for user ${userId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        const chainCompleted = outcome.chainProgress?.chainCompleted === true;
        const lina = {
            trigger: chainCompleted
                ? LinaTrigger.CHAIN_COMPLETED
                : outcome.rankBefore !== outcome.rankAfter
                  ? LinaTrigger.RANK_PROMOTED
                  : LinaTrigger.CONTRACT_CLAIMED,
            pose: LinaPose.HAPPY,
            context: {
                contractId: outcome.contractDto.id,
                xpAwarded: outcome.totalXp,
                sealsAwarded: outcome.sealsAwarded,
                rankBefore: outcome.rankBefore,
                rankAfter: outcome.rankAfter,
                rankedUp: outcome.rankBefore !== outcome.rankAfter,
                ...(chainCompleted
                    ? { chainKey: outcome.chainProgress!.chainKey }
                    : {}),
            },
            hasUnseenBoard: outcome.hasUnseenBoard,
        };

        return {
            contract: outcome.contractDto,
            xpAwarded: outcome.totalXp,
            globalXpAwarded: outcome.globalXpAwarded,
            rankBefore: outcome.rankBefore,
            rankAfter: outcome.rankAfter,
            sealsAwarded: outcome.sealsAwarded,
            bonusCompleted: outcome.bonusCompleted,
            unlockedRewards: outcome.unlockedRewards,
            chestResult: outcome.chestResult,
            promotionRewards: outcome.promotionRewards,
            prestigeRewards: outcome.prestigeRewards,
            passportMonth: outcome.passportMonth,
            chainProgress: outcome.chainProgress,
            lina,
        };
    }

    /**
     * Intentional bonus objectives are re-checked at claim time so a review written
     * after the game was finished still counts (design 4). Collection ids are kept
     * for the 30-day anti-farming cooldown.
     */
    private async recheckClaimObjectives(
        manager: EntityManager,
        contract: GuildContract,
        now: Date,
    ): Promise<{ bonusCompleted: boolean; creditedCollectionIds: string[] }> {
        const needsEvaluation =
            contract.objectiveType === GuildObjectiveType.CURATE_COLLECTION ||
            contract.bonusObjective?.type === "also_write_review";
        let creditedCollectionIds: string[] = [];
        let bonusCompleted = contract.bonusCompleted === true;
        if (!needsEvaluation) return { bonusCompleted, creditedCollectionIds };

        try {
            const evaluation =
                await this.evaluatorService.evaluateContractWithManager(
                    manager,
                    contract,
                    now,
                );
            if (
                contract.objectiveType === GuildObjectiveType.CURATE_COLLECTION
            ) {
                creditedCollectionIds = evaluation.sourceKeys;
            }
            if (
                contract.bonusObjective?.type === "also_write_review" &&
                !bonusCompleted
            ) {
                bonusCompleted = await evaluateGuildBonusObjective({
                    query: manager,
                    contract,
                    evaluation,
                    now,
                });
            }
        } catch (error) {
            // A bonus/evaluation failure must never block the base claim.
            this.logger.warn(
                `Guild claim-time evaluation failed for contract ${contract.id}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        return { bonusCompleted, creditedCollectionIds };
    }

    public async extendContract(
        userId: string,
        contractId: string,
        now = new Date(),
    ): Promise<ExtendGuildContractResponseDto> {
        return this.dataSource.transaction(async (manager) => {
            // Design 6 lock order: contract, then profile.
            const [locked] = await manager.query(
                "SELECT id, status, expiresAt, extendedCount, eventId FROM guild_contract WHERE id = ? AND profileUserId = ? FOR UPDATE",
                [contractId, userId],
            );
            if (!locked) {
                throw new NotFoundException("Contract not found.");
            }
            if (locked.status !== GuildContractStatus.ACTIVE) {
                throw new ConflictException({
                    message: "Only active contracts can be extended.",
                    code: "guild_contract_not_active",
                });
            }
            if (
                locked.expiresAt !== null &&
                new Date(locked.expiresAt) <= now
            ) {
                throw new ConflictException({
                    message: "This contract has already expired.",
                    code: "guild_contract_expired",
                });
            }
            if (Number(locked.extendedCount) > 0) {
                throw new ConflictException({
                    message: "This contract was already extended.",
                    code: "guild_contract_already_extended",
                });
            }

            await manager.query(
                "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
                [userId],
            );
            const [profile] = await manager.query(
                "SELECT `rank` AS guildRank, freeHourglassMonthKey FROM guild_profile WHERE profileUserId = ?",
                [userId],
            );
            const monthKey = currentMonthKey(now);
            const freeHourglassAvailable =
                getGuildRankPerks(profile?.guildRank ?? GuildRank.E)
                    .monthlyFreeHourglass > 0 &&
                profile?.freeHourglassMonthKey !== monthKey;
            let usedFreeMonthlyHourglass = false;
            if (freeHourglassAvailable) {
                await manager.query(
                    "UPDATE guild_profile SET freeHourglassMonthKey = ? WHERE profileUserId = ?",
                    [monthKey, userId],
                );
                usedFreeMonthlyHourglass = true;
            } else {
                // Throws 409 guild_consumable_not_owned when the inventory is empty.
                await this.sealsService.consumeConsumableWithManager(
                    manager,
                    userId,
                    GuildConsumableKey.HOURGLASS,
                );
            }

            const baseExpiresAt =
                locked.expiresAt === null ? now : new Date(locked.expiresAt);
            let expiresAt = new Date(baseExpiresAt.getTime() + 7 * DAY_MS);
            if (locked.eventId) {
                const [event] = await manager.query(
                    "SELECT endsAt FROM guild_event WHERE id = ?",
                    [locked.eventId],
                );
                if (event?.endsAt) {
                    const cap = new Date(
                        new Date(event.endsAt).getTime() + 7 * DAY_MS,
                    );
                    if (expiresAt > cap) expiresAt = cap;
                }
            }

            await manager.query(
                "UPDATE guild_contract SET expiresAt = ?, extendedCount = 1, expiringNotifiedAt = NULL WHERE id = ?",
                [expiresAt, contractId],
            );
            const contract = await manager
                .getRepository(GuildContract)
                .findOneOrFail({
                    where: { id: contractId },
                    relations: CONTRACT_RELATIONS,
                });
            const [contractDto] = await this.enrichContracts(
                userId,
                [contract],
                now,
                manager,
            );
            const balances = await this.sealsService.getConsumableBalances(
                userId,
                manager,
            );
            return {
                contract: contractDto,
                extensionDays: 7,
                usedFreeMonthlyHourglass,
                remainingHourglasses: balances[GuildConsumableKey.HOURGLASS],
            };
        });
    }

    public async abandonContract(
        userId: string,
        contractId: string,
    ): Promise<GuildContractDto> {
        const repository = this.contractRepository();
        const contract = await repository.findOne({
            where: { id: contractId, profileUserId: userId },
            relations: CONTRACT_RELATIONS,
        });
        if (!contract) {
            throw new NotFoundException("Contract not found.");
        }
        if (contract.status !== GuildContractStatus.ACTIVE) {
            throw new ConflictException({
                message: "Only active contracts can be abandoned.",
                code: "guild_contract_not_active",
            });
        }

        const updated = await this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(GuildContract);
            const result = await repository.update(
                {
                    id: contractId,
                    profileUserId: userId,
                    status: GuildContractStatus.ACTIVE,
                },
                { status: GuildContractStatus.ABANDONED },
            );
            if (!result.affected) {
                throw new ConflictException({
                    message: "Only active contracts can be abandoned.",
                    code: "guild_contract_not_active",
                });
            }
            // Same transaction: a chain stage never points at an abandoned contract.
            if (contract.chainProgressId) {
                await manager.query(
                    "UPDATE guild_user_chain SET activeContractId = NULL WHERE id = ? AND activeContractId = ?",
                    [contract.chainProgressId, contractId],
                );
            }
            return repository.findOneOrFail({
                where: { id: contractId },
                relations: CONTRACT_RELATIONS,
            });
        });

        const [contractDto] = await this.enrichContracts(
            userId,
            [updated],
            new Date(),
        );
        return contractDto;
    }

    private contractRepository() {
        return this.dataSource.getRepository(GuildContract);
    }

    private async findContractOrFail(
        userId: string,
        contractId: string,
        manager?: EntityManager,
    ): Promise<GuildContract> {
        return (manager ?? this.dataSource)
            .getRepository(GuildContract)
            .findOneOrFail({
                where: { id: contractId, profileUserId: userId },
                relations: CONTRACT_RELATIONS,
            });
    }

    private async loadBoardEntry(
        userId: string,
        boardEntryId: string,
    ): Promise<GuildBoardEntry> {
        const entry = await this.dataSource
            .getRepository(GuildBoardEntry)
            .findOne({
                where: { id: boardEntryId, profileUserId: userId },
                relations: { reward: true },
            });
        if (!entry) {
            throw new NotFoundException("Board quest not found.");
        }
        return entry;
    }

    private async loadActiveEvent(
        eventId: string,
        now: Date,
        manager?: EntityManager,
    ): Promise<GuildEvent> {
        const event = await (manager ?? this.dataSource)
            .getRepository(GuildEvent)
            .findOne({ where: { id: eventId } });
        if (!event || event.status !== GuildEventStatus.PUBLISHED) {
            throw new NotFoundException("Event not found.");
        }
        if (!(event.startsAt <= now && event.endsAt > now)) {
            throw new BadRequestException("This event is not active.");
        }
        return event;
    }

    private async assertTargetGame(
        userId: string,
        entry: GuildBoardEntry | null,
        event: GuildEvent | null,
        targetGameId: number | undefined,
        now: Date,
        manager: EntityManager,
    ): Promise<void> {
        if (entry?.requiresTargetGame && targetGameId == null) {
            throw new BadRequestException(
                "targetGameId is required for this quest.",
            );
        }
        if (targetGameId == null) return;

        const [game] = await manager.query("SELECT id FROM game WHERE id = ?", [
            targetGameId,
        ]);
        if (!game) {
            throw new BadRequestException(
                "targetGameId does not reference an existing game.",
            );
        }

        const objectiveType = entry?.objectiveType ?? event!.objectiveType;
        const criteria = entry?.criteria ?? event!.criteria ?? {};
        const templateKey = entry?.templateKey ?? null;

        if (objectiveType === GuildObjectiveType.FINISH_GAME) {
            // The evaluator counts DISTINCT games, so a bound target would freeze multi-game progress.
            if ((entry?.targetCount ?? event!.targetCount) > 1) {
                throw new BadRequestException(
                    "targetGameId cannot be set on multi-game finish quests.",
                );
            }

            const [libraryEntry] = await manager.query(
                "SELECT status FROM collection_entry WHERE libraryUserId = ? AND gameId = ? ORDER BY updatedAt DESC LIMIT 1",
                [userId, targetGameId],
            );
            // A game finished once stays ineligible after a status toggle. Review quests may bind it.
            const [everFinished] = await manager.query(
                "SELECT 1 AS ok FROM collection_entry_status_history WHERE libraryUserId = ? AND gameId = ? AND toStatus = ? LIMIT 1",
                [userId, targetGameId, CollectionEntryStatus.FINISHED],
            );
            if (
                libraryEntry?.status === CollectionEntryStatus.FINISHED ||
                everFinished
            ) {
                throw new BadRequestException(
                    "This game is already finished in your library.",
                );
            }

            if (templateKey === "recent_dust") {
                await this.assertStaleBacklogGame(
                    userId,
                    targetGameId,
                    now,
                    manager,
                    RECENT_DUST_DAYS,
                );
            } else if (templateKey === "forgotten_relic") {
                await this.assertStaleBacklogGame(
                    userId,
                    targetGameId,
                    now,
                    manager,
                    STALE_BACKLOG_DAYS,
                );
            } else if (templateKey === "ancient_fossil") {
                await this.assertStaleBacklogGame(
                    userId,
                    targetGameId,
                    now,
                    manager,
                    await this.ancientFossilDays(userId, now, manager),
                );
            } else if (templateKey === "deep_dive") {
                if (
                    libraryEntry?.status !== CollectionEntryStatus.PLAYING &&
                    libraryEntry?.status !== CollectionEntryStatus.ONGOING
                ) {
                    throw new BadRequestException(
                        "This quest requires a game you are currently playing.",
                    );
                }
            }
        }

        const matches = await gameMatchesGuildCriteria(
            manager,
            targetGameId,
            criteria,
            {
                now,
                timeToBeat: this.guildTimeToBeatService,
                userId,
                libraryStatuses: criteria.status
                    ? [criteria.status]
                    : undefined,
            },
        );
        if (!matches) {
            throw new BadRequestException(
                "This game does not match the quest criteria.",
            );
        }
    }

    private async assertStaleBacklogGame(
        userId: string,
        gameId: number,
        now: Date,
        manager: EntityManager,
        staleDays: number,
    ): Promise<void> {
        const cutoff = new Date(now.getTime() - staleDays * DAY_MS);
        const [eligible] = await manager.query(
            `SELECT ce.id FROM collection_entry ce
             WHERE ce.libraryUserId = ? AND ce.gameId = ?
               AND ce.status IN (?, ?)
               AND COALESCE(ce.plannedAt, ce.createdAt) < ?
               AND NOT EXISTS (
                   SELECT 1 FROM user_playtime up
                   WHERE up.profileUserId = ce.libraryUserId
                     AND up.gameId = ce.gameId
                     AND up.lastPlayedDate >= ?
               )
             LIMIT 1`,
            [
                userId,
                gameId,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.DROPPED,
                cutoff,
                cutoff,
            ],
        );
        if (!eligible) {
            throw new BadRequestException(
                "This game is not an eligible stale backlog game.",
            );
        }
    }

    /** Mirrors `GuildProceduralBoardService`: 2+ year libraries accept 730-day games. */
    private async ancientFossilDays(
        userId: string,
        now: Date,
        manager: EntityManager,
    ): Promise<number> {
        const [profile] = await manager.query(
            "SELECT createdAt FROM profile WHERE userId = ?",
            [userId],
        );
        const libraryAgeDays = profile
            ? (now.getTime() - new Date(profile.createdAt).getTime()) / DAY_MS
            : 0;
        return libraryAgeDays >= VETERAN_LIBRARY_DAYS
            ? VETERAN_LIBRARY_DAYS
            : ANCIENT_FOSSIL_DAYS;
    }

    private async enrichContracts(
        userId: string,
        contracts: GuildContract[],
        now: Date,
        manager?: EntityManager,
    ): Promise<GuildContractDto[]> {
        if (contracts.length === 0) return [];
        const executor = manager ?? this.dataSource;

        const targetGameIds = [
            ...new Set(
                contracts
                    .filter((contract) => contract.targetGameId !== null)
                    .map((contract) => Number(contract.targetGameId)),
            ),
        ];
        const games = new Map<number, GuildContractTargetGameDto>();
        if (targetGameIds.length > 0) {
            const rows: Array<{
                id: number;
                name: string;
                slug: string | null;
                coverUrl: string | null;
            }> = await executor.query(
                `SELECT g.id, g.name, g.slug, gc.url AS coverUrl
                 FROM game g
                 LEFT JOIN game_cover gc ON gc.gameId = g.id
                 WHERE g.id IN (${targetGameIds.map(() => "?").join(",")})`,
                targetGameIds,
            );
            for (const row of rows) {
                games.set(Number(row.id), {
                    gameId: Number(row.id),
                    name: row.name,
                    slug: row.slug ?? null,
                    coverUrl: igdbImageUrl(
                        row.coverUrl ?? undefined,
                        "t_cover_big",
                    ),
                });
            }
        }

        const playtimeByGame = await this.playtimeProgress(
            userId,
            contracts,
            now,
            manager,
        );

        return contracts.map((contract) =>
            this.toContractDto(contract, games, playtimeByGame),
        );
    }

    private async playtimeProgress(
        userId: string,
        contracts: GuildContract[],
        now: Date,
        manager?: EntityManager,
    ): Promise<Map<number, GuildContractPlaytimeProgressDto>> {
        const playtimeContracts = contracts.filter(
            (contract) =>
                contract.status === GuildContractStatus.ACTIVE &&
                contract.objectiveType === GuildObjectiveType.FINISH_GAME &&
                contract.targetGameId !== null,
        );
        const gameIds = [
            ...new Set(
                playtimeContracts.map((contract) =>
                    Number(contract.targetGameId),
                ),
            ),
        ];
        if (gameIds.length === 0) return new Map();

        const [rows, cached] = await Promise.all([
            (manager ?? this.dataSource).query(
                `SELECT gameId, COALESCE(SUM(totalPlaytimeSeconds), 0) AS playedSeconds
                 FROM user_playtime
                 WHERE profileUserId = ? AND gameId IN (${gameIds.map(() => "?").join(",")})
                 GROUP BY gameId`,
                [userId, ...gameIds],
            ),
            this.guildTimeToBeatService.getForGameIds(gameIds, now),
        ]);
        const playedByGame = new Map<number, number>(
            (rows as Array<{ gameId: number; playedSeconds: number }>).map(
                (row) => [Number(row.gameId), Number(row.playedSeconds)],
            ),
        );

        const progress = new Map<number, GuildContractPlaytimeProgressDto>();
        for (const gameId of gameIds) {
            const playedSeconds = playedByGame.get(gameId) ?? 0;
            const estimatedTotalSeconds = getEffectiveTtbSeconds(
                cached.get(gameId),
            );
            progress.set(gameId, {
                playedSeconds,
                estimatedTotalSeconds,
                estimatedPercent:
                    estimatedTotalSeconds !== null && estimatedTotalSeconds > 0
                        ? Math.min(
                              99,
                              Math.max(
                                  0,
                                  Math.round(
                                      (playedSeconds / estimatedTotalSeconds) *
                                          100,
                                  ),
                              ),
                          )
                        : null,
            });
        }
        return progress;
    }

    private toContractDto(
        contract: GuildContract,
        games: Map<number, GuildContractTargetGameDto>,
        playtimeByGame: Map<number, GuildContractPlaytimeProgressDto>,
    ): GuildContractDto {
        const targetGameId =
            contract.targetGameId === null
                ? null
                : Number(contract.targetGameId);
        const event: GuildContractEventSummaryDto | null = contract.event
            ? {
                  id: contract.event.id,
                  slug: contract.event.slug,
                  title: contract.event.title,
                  description: contract.event.description,
                  translations: [...(contract.event.translations ?? [])]
                      .sort((a, b) => a.locale.localeCompare(b.locale))
                      .map((translation) => ({
                          locale: translation.locale,
                          title: translation.title,
                          description: translation.description,
                      })),
              }
            : null;

        return {
            id: contract.id,
            boardEntryId: contract.boardEntryId,
            eventId: contract.eventId,
            category: contract.category,
            templateKey: contract.templateKey,
            rank: contract.rank,
            xpReward: contract.xpReward,
            sealsReward: contract.sealsReward,
            objectiveType: contract.objectiveType,
            criteria: contract.criteria,
            bonusObjective: contract.bonusObjective,
            bonusCompleted: contract.bonusCompleted,
            extendedCount: contract.extendedCount,
            chainProgressId: contract.chainProgressId,
            targetGameId,
            targetGame:
                targetGameId === null
                    ? null
                    : (games.get(targetGameId) ?? null),
            progressCurrent: contract.progressCurrent,
            progressTarget: contract.progressTarget,
            status: contract.status,
            playtimeProgress:
                targetGameId === null
                    ? null
                    : (playtimeByGame.get(targetGameId) ?? null),
            reward: contract.reward
                ? toRewardDescriptor(contract.reward)
                : null,
            event,
            claimPayload: contract.claimPayload ?? null,
            acceptedAt: contract.acceptedAt,
            readyAt: contract.readyAt,
            claimedAt: contract.claimedAt,
            expiresAt: contract.expiresAt,
            createdAt: contract.createdAt,
            updatedAt: contract.updatedAt,
        };
    }
}
