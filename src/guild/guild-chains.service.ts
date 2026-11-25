import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import {
    AdvanceGuildChainDto,
    GuildActiveChainSummaryDto,
    GuildChainActionResponseDto,
    GuildChainClaimProgressDto,
    GuildChainDto,
    GuildChainListStatus,
    GuildChainsResponseDto,
    GuildChainStageDto,
    StartGuildChainDto,
} from "./dto/guild-chains.dto";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import { GuildUserChain } from "./entities/guild-user-chain.entity";
import {
    DAY_MS,
    GUILD_CHAIN_FINAL_REWARDS,
    GUILD_MAX_ACTIVE_CONTRACTS_WITH_PERMIT,
    GuildCategory,
    GuildChainKey,
    GuildChainStatus,
    GuildContractStatus,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
    GuildSealReason,
    currentWeekStart,
    getGuildRankPerks,
    guildRankAtLeast,
    igdbImageUrl,
    toRewardDescriptor,
} from "./guild.constants";
import { GuildSealsService } from "./guild-seals.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import { gameMatchesGuildCriteria } from "./evaluators/game-criteria";

export interface GuildChainStageDefinition {
    stageKey: string;
    objectiveType: GuildObjectiveType;
    targetCount: number;
    criteria: GuildCriteria;
    xpReward: number;
    sealsReward: number;
    durationDays: number;
    /** Stage runs on the game bound when the chain started. */
    usesBoundTargetGame: boolean;
}

export interface GuildChainDefinition {
    chainKey: GuildChainKey;
    titleKey: string;
    minRank: GuildRank;
    finalBonusSeals: number;
    stages: readonly GuildChainStageDefinition[];
}

/**
 * The three code-defined 3-stage narrative arcs (spec: guild-quest-chains).
 * `pathfinders_arc` binds one game across every stage; the other arcs use
 * platform-wide objectives.
 */
export const GUILD_QUEST_CHAINS: readonly GuildChainDefinition[] = [
    {
        chainKey: "pathfinders_arc",
        titleKey: "guild_chain_pathfinders_arc_title",
        minRank: GuildRank.E,
        finalBonusSeals: 100,
        stages: [
            {
                stageKey: "trail_head",
                // Total minutes on the bound game: a per-game floor would switch
                // `log_playtime` to distinct-game counting and cap progress at 1.
                objectiveType: GuildObjectiveType.LOG_PLAYTIME,
                targetCount: 120,
                criteria: {},
                xpReward: 100,
                sealsReward: 15,
                durationDays: 21,
                usesBoundTargetGame: true,
            },
            {
                stageKey: "summit_push",
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetCount: 1,
                criteria: {},
                xpReward: 180,
                sealsReward: 25,
                durationDays: 21,
                usesBoundTargetGame: true,
            },
            {
                stageKey: "field_notes",
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                targetCount: 1,
                criteria: { minReviewChars: 80 },
                xpReward: 260,
                sealsReward: 35,
                durationDays: 21,
                usesBoundTargetGame: true,
            },
        ],
    },
    {
        chainKey: "curators_arc",
        titleKey: "guild_chain_curators_arc_title",
        minRank: GuildRank.D,
        finalBonusSeals: 120,
        stages: [
            {
                stageKey: "first_exhibit",
                objectiveType: GuildObjectiveType.CURATE_COLLECTION,
                targetCount: 1,
                criteria: { minCollectionEntries: 5 },
                xpReward: 120,
                sealsReward: 20,
                durationDays: 14,
                usesBoundTargetGame: false,
            },
            {
                stageKey: "curated_finish",
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetCount: 1,
                criteria: {},
                xpReward: 200,
                sealsReward: 30,
                durationDays: 21,
                usesBoundTargetGame: false,
            },
            {
                stageKey: "curators_essay",
                objectiveType: GuildObjectiveType.PUBLISH_POST,
                targetCount: 1,
                criteria: { minPostChars: 200 },
                xpReward: 260,
                sealsReward: 40,
                durationDays: 14,
                usesBoundTargetGame: false,
            },
        ],
    },
    {
        chainKey: "relic_hunters_arc",
        titleKey: "guild_chain_relic_hunters_arc_title",
        minRank: GuildRank.C,
        finalBonusSeals: 200,
        stages: [
            {
                stageKey: "relic_triage",
                objectiveType: GuildObjectiveType.TRIAGE_BACKLOG,
                targetCount: 3,
                criteria: {},
                xpReward: 160,
                sealsReward: 25,
                durationDays: 14,
                usesBoundTargetGame: false,
            },
            {
                stageKey: "relic_finish",
                objectiveType: GuildObjectiveType.FINISH_GAME,
                targetCount: 1,
                criteria: {},
                xpReward: 280,
                sealsReward: 45,
                durationDays: 30,
                usesBoundTargetGame: false,
            },
            {
                stageKey: "relic_chronicle",
                objectiveType: GuildObjectiveType.WRITE_REVIEW,
                targetCount: 2,
                criteria: { minReviewChars: 150 },
                xpReward: 340,
                sealsReward: 60,
                durationDays: 21,
                usesBoundTargetGame: false,
            },
        ],
    },
];

const CHAIN_BY_KEY = new Map(
    GUILD_QUEST_CHAINS.map((chain) => [chain.chainKey, chain]),
);

const toDateKey = (value: unknown): string | null => {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
};

/** Rank cap plus the current week's `extra_slot_permit`, never above 5. */
export function resolveActiveContractLimit(
    rank: GuildRank,
    extraSlotPermitWeekStart: unknown,
    weekStart: string,
): number {
    const base = getGuildRankPerks(rank).maxActiveContracts;
    return toDateKey(extraSlotPermitWeekStart) === weekStart
        ? Math.min(base + 1, GUILD_MAX_ACTIVE_CONTRACTS_WITH_PERMIT)
        : base;
}

const stageTemplateKey = (chainKey: string, stageIndex: number) =>
    `${chainKey}:${GUILD_QUEST_CHAINS.find((chain) => chain.chainKey === chainKey)?.stages[stageIndex]?.stageKey ?? stageIndex}`;

/**
 * Multi-stage narrative Quest Chains (design 8): catalog, start/advance and the
 * claim-time stage progression hook used by `GuildContractsService`.
 */
@Injectable()
export class GuildChainsService {
    private readonly sealsService: GuildSealsService;

    constructor(
        private readonly dataSource: DataSource,
        @Optional() sealsService?: GuildSealsService,
        @Optional() private readonly timeToBeatService?: GuildTimeToBeatService,
    ) {
        // Optional so GuildModule stays green until Wave 5 registers the service.
        this.sealsService = sealsService ?? new GuildSealsService(dataSource);
    }

    public async listChains(
        userId: string,
        now = new Date(),
    ): Promise<GuildChainsResponseDto> {
        const chains = await this.buildChains(userId, now);
        return { chains };
    }

    /** Lightweight `GET /v1/guild` overview summary; null when no arc is running. */
    public async getActiveChainSummary(
        userId: string,
    ): Promise<GuildActiveChainSummaryDto | null> {
        const progress = await this.dataSource
            .getRepository(GuildUserChain)
            .findOne({
                where: {
                    profileUserId: userId,
                    status: GuildChainStatus.IN_PROGRESS,
                },
                order: { startedAt: "ASC" },
            });
        if (!progress) return null;
        const definition = CHAIN_BY_KEY.get(progress.chainKey as GuildChainKey);
        if (!definition) return null;
        return {
            chainKey: definition.chainKey,
            status: progress.status,
            currentStageIndex: Number(progress.currentStageIndex),
            totalStages: definition.stages.length,
            boundTargetGameId:
                progress.boundTargetGameId === null
                    ? null
                    : Number(progress.boundTargetGameId),
            activeContractId: progress.activeContractId,
        };
    }

    public async startChain(
        userId: string,
        chainKey: GuildChainKey,
        dto: StartGuildChainDto,
        now = new Date(),
    ): Promise<GuildChainActionResponseDto> {
        const definition = this.definitionOrFail(chainKey);

        const contractId = await this.dataSource.transaction(
            async (manager) => {
                // Design 6 lock order: guild_user_chain, then guild_profile.
                const [existing] = await manager.query(
                    "SELECT id, status FROM guild_user_chain WHERE profileUserId = ? AND chainKey = ? FOR UPDATE",
                    [userId, chainKey],
                );
                if (existing) {
                    throw new ConflictException({
                        message:
                            existing.status === GuildChainStatus.COMPLETED
                                ? "You already completed this chain."
                                : "You already started this chain.",
                        code:
                            existing.status === GuildChainStatus.COMPLETED
                                ? "guild_chain_already_completed"
                                : "guild_chain_already_started",
                    });
                }

                const profile = await this.lockProfile(manager, userId);
                if (!guildRankAtLeast(profile.rank, definition.minRank)) {
                    throw new ForbiddenException({
                        message: `This chain requires Guild Rank ${definition.minRank}.`,
                        code: "guild_chain_rank_required",
                    });
                }

                await this.assertActiveContractSlot(
                    manager,
                    userId,
                    profile,
                    now,
                );

                const stage = definition.stages[0];
                let boundTargetGameId: number | null = null;
                if (stage.usesBoundTargetGame || dto.targetGameId != null) {
                    boundTargetGameId = await this.assertTargetGame(
                        manager,
                        userId,
                        stage,
                        dto.targetGameId,
                        stage.usesBoundTargetGame,
                        now,
                    );
                }

                const chainId = randomUUID();
                await manager.getRepository(GuildUserChain).insert({
                    id: chainId,
                    profileUserId: userId,
                    chainKey,
                    status: GuildChainStatus.IN_PROGRESS,
                    currentStageIndex: 0,
                    boundTargetGameId,
                    activeContractId: null,
                    startedAt: now,
                    completedAt: null,
                });

                const contractId = await this.createStageContract(
                    manager,
                    userId,
                    chainId,
                    definition,
                    0,
                    boundTargetGameId,
                    now,
                );
                await manager.query(
                    "UPDATE guild_user_chain SET activeContractId = ? WHERE id = ?",
                    [contractId, chainId],
                );
                return contractId;
            },
        );

        const chain = await this.chainOrFail(userId, chainKey, now);
        return { chain, contractId };
    }

    public async advanceChain(
        userId: string,
        chainKey: GuildChainKey,
        dto: AdvanceGuildChainDto = {},
        now = new Date(),
    ): Promise<GuildChainActionResponseDto> {
        const definition = this.definitionOrFail(chainKey);

        const contractId = await this.dataSource.transaction(
            async (manager) => {
                // Design 6 lock order: guild_user_chain, then guild_profile.
                const [progress] = await manager.query(
                    "SELECT id, status, currentStageIndex, boundTargetGameId FROM guild_user_chain WHERE profileUserId = ? AND chainKey = ? FOR UPDATE",
                    [userId, chainKey],
                );
                const profile = await this.lockProfile(manager, userId);
                if (!progress) {
                    throw new NotFoundException("Guild chain not started.");
                }
                if (progress.status === GuildChainStatus.COMPLETED) {
                    throw new ConflictException({
                        message: "You already completed this chain.",
                        code: "guild_chain_already_completed",
                    });
                }

                const stageIndex = Number(progress.currentStageIndex);
                const stage = definition.stages[stageIndex];
                if (!stage) {
                    throw new ConflictException({
                        message: "You already completed this chain.",
                        code: "guild_chain_already_completed",
                    });
                }

                const [running] = await manager.query(
                    "SELECT id FROM guild_contract WHERE chainProgressId = ? AND status IN (?, ?) LIMIT 1",
                    [
                        progress.id,
                        GuildContractStatus.ACTIVE,
                        GuildContractStatus.READY_TO_CLAIM,
                    ],
                );
                if (running) {
                    throw new ConflictException({
                        message:
                            "Finish or abandon the current chain stage first.",
                        code: "guild_chain_stage_active",
                    });
                }

                await this.assertActiveContractSlot(
                    manager,
                    userId,
                    profile,
                    now,
                );

                let boundTargetGameId =
                    progress.boundTargetGameId === null
                        ? null
                        : Number(progress.boundTargetGameId);
                if (stage.usesBoundTargetGame && boundTargetGameId === null) {
                    boundTargetGameId = await this.assertTargetGame(
                        manager,
                        userId,
                        stage,
                        dto.targetGameId,
                        true,
                        now,
                    );
                    await manager.query(
                        "UPDATE guild_user_chain SET boundTargetGameId = ? WHERE id = ?",
                        [boundTargetGameId, progress.id],
                    );
                }

                const contractId = await this.createStageContract(
                    manager,
                    userId,
                    progress.id,
                    definition,
                    stageIndex,
                    boundTargetGameId,
                    now,
                );
                await manager.query(
                    "UPDATE guild_user_chain SET activeContractId = ? WHERE id = ?",
                    [contractId, progress.id],
                );
                return contractId;
            },
        );

        const chain = await this.chainOrFail(userId, chainKey, now);
        return { chain, contractId };
    }

    /**
     * Called by `GuildContractsService.claimContract` inside its transaction,
     * after the `guild_contract` and `guild_user_chain` locks. Returns null when
     * the claimed contract is not the chain's current stage.
     */
    public async onChainContractClaimedWithManager(
        manager: EntityManager,
        userId: string,
        contract: Pick<GuildContract, "id" | "chainProgressId" | "templateKey">,
        now = new Date(),
    ): Promise<GuildChainClaimProgressDto | null> {
        if (!contract.chainProgressId) return null;
        const [progress] = await manager.query(
            "SELECT id, profileUserId, chainKey, status, currentStageIndex FROM guild_user_chain WHERE id = ? FOR UPDATE",
            [contract.chainProgressId],
        );
        if (!progress || progress.profileUserId !== userId) return null;
        if (progress.status !== GuildChainStatus.IN_PROGRESS) return null;

        const definition = CHAIN_BY_KEY.get(progress.chainKey as GuildChainKey);
        if (!definition) return null;
        const stageIndex = Number(progress.currentStageIndex);
        if (
            contract.templateKey !==
            stageTemplateKey(definition.chainKey, stageIndex)
        ) {
            return null;
        }

        const finalStageIndex = definition.stages.length - 1;
        if (stageIndex < finalStageIndex) {
            const nextStageIndex = stageIndex + 1;
            await manager.query(
                "UPDATE guild_user_chain SET currentStageIndex = ?, activeContractId = NULL WHERE id = ?",
                [nextStageIndex, progress.id],
            );
            return {
                chainKey: definition.chainKey,
                currentStageIndex: nextStageIndex,
                status: GuildChainStatus.IN_PROGRESS,
                chainCompleted: false,
                finalRewards: [],
                bonusSealsAwarded: 0,
            };
        }

        const finalRewards = await this.grantFinalRewards(
            manager,
            userId,
            definition,
            contract.id,
            now,
        );
        await manager.query(
            "UPDATE guild_user_chain SET status = ?, activeContractId = NULL, completedAt = ? WHERE id = ?",
            [GuildChainStatus.COMPLETED, now, progress.id],
        );
        if (definition.finalBonusSeals > 0) {
            await this.sealsService.creditSealsWithManager(
                manager,
                userId,
                definition.finalBonusSeals,
                GuildSealReason.CHAIN_COMPLETE,
                contract.id,
            );
        }

        return {
            chainKey: definition.chainKey,
            currentStageIndex: stageIndex,
            status: GuildChainStatus.COMPLETED,
            chainCompleted: true,
            finalRewards,
            bonusSealsAwarded: definition.finalBonusSeals,
        };
    }

    private async createStageContract(
        manager: EntityManager,
        userId: string,
        chainId: string,
        definition: GuildChainDefinition,
        stageIndex: number,
        boundTargetGameId: number | null,
        acceptedAt: Date,
    ): Promise<string> {
        const stage = definition.stages[stageIndex];
        const contractId = randomUUID();
        await manager.getRepository(GuildContract).insert({
            id: contractId,
            profileUserId: userId,
            boardEntryId: null,
            eventId: null,
            category: GuildCategory.WEEKLY,
            templateKey: stageTemplateKey(definition.chainKey, stageIndex),
            rank: definition.minRank,
            xpReward: stage.xpReward,
            sealsReward: stage.sealsReward,
            objectiveType: stage.objectiveType,
            criteria: stage.criteria,
            bonusObjective: null,
            targetGameId: stage.usesBoundTargetGame ? boundTargetGameId : null,
            progressCurrent: 0,
            progressTarget: stage.targetCount,
            status: GuildContractStatus.ACTIVE,
            rewardId: null,
            chainProgressId: chainId,
            claimPayload: null,
            acceptedAt,
            readyAt: null,
            claimedAt: null,
            expiresAt: new Date(
                acceptedAt.getTime() + stage.durationDays * DAY_MS,
            ),
        });
        return contractId;
    }

    private async assertActiveContractSlot(
        manager: EntityManager,
        userId: string,
        profile: Pick<GuildProfile, "rank" | "extraSlotPermitWeekStart">,
        now: Date,
    ): Promise<void> {
        const [row] = await manager.query(
            "SELECT COUNT(*) AS total FROM guild_contract WHERE profileUserId = ? AND status IN (?, ?)",
            [
                userId,
                GuildContractStatus.ACTIVE,
                GuildContractStatus.READY_TO_CLAIM,
            ],
        );
        const limit = resolveActiveContractLimit(
            profile.rank,
            profile.extraSlotPermitWeekStart,
            currentWeekStart(now),
        );
        if (Number(row.total) >= limit) {
            throw new ConflictException({
                message: `You already hold the maximum of ${limit} active contracts.`,
                code: "guild_active_contract_limit_reached",
            });
        }
    }

    /** Validates the target exists and matches the stage criteria (400 otherwise). */
    private async assertTargetGame(
        manager: EntityManager,
        userId: string,
        stage: GuildChainStageDefinition,
        targetGameId: number | undefined,
        required: boolean,
        now: Date,
    ): Promise<number | null> {
        if (targetGameId == null) {
            if (required) {
                throw new BadRequestException(
                    "targetGameId is required for this chain stage.",
                );
            }
            return null;
        }
        const [game] = await manager.query("SELECT id FROM game WHERE id = ?", [
            targetGameId,
        ]);
        if (!game) {
            throw new BadRequestException(
                "targetGameId does not reference an existing game.",
            );
        }
        const matches = await gameMatchesGuildCriteria(
            manager,
            targetGameId,
            stage.criteria,
            { now, timeToBeat: this.timeToBeatService, userId },
        );
        if (!matches) {
            throw new BadRequestException(
                "This game does not match the chain stage criteria.",
            );
        }
        return targetGameId;
    }

    private async grantFinalRewards(
        manager: EntityManager,
        userId: string,
        definition: GuildChainDefinition,
        contractId: string,
        now: Date,
    ) {
        const keys = GUILD_CHAIN_FINAL_REWARDS[definition.chainKey] ?? [];
        if (keys.length === 0) return [];
        const rewards = await manager.getRepository(GuildReward).find({
            where: { key: In([...keys]) },
        });
        const granted = [];
        for (const reward of rewards) {
            const result = await manager.query(
                "INSERT IGNORE INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, ?, ?)",
                [userId, reward.id, contractId, now],
            );
            if (result.affectedRows > 0) {
                granted.push(toRewardDescriptor(reward));
            }
        }
        return granted;
    }

    private async chainOrFail(
        userId: string,
        chainKey: GuildChainKey,
        now: Date,
    ): Promise<GuildChainDto> {
        const chains = await this.buildChains(userId, now);
        const chain = chains.find((item) => item.chainKey === chainKey);
        if (!chain) throw new NotFoundException("Guild chain not found.");
        return chain;
    }

    private async buildChains(
        userId: string,
        now: Date,
    ): Promise<GuildChainDto[]> {
        const [profile, progressRows] = await Promise.all([
            this.dataSource
                .getRepository(GuildProfile)
                .findOneBy({ profileUserId: userId }),
            this.dataSource
                .getRepository(GuildUserChain)
                .find({ where: { profileUserId: userId } }),
        ]);
        const rank = profile?.rank ?? GuildRank.E;
        const progressByKey = new Map(
            progressRows.map((row) => [row.chainKey, row]),
        );

        const boundGameIds = [
            ...new Set(
                progressRows
                    .filter((row) => row.boundTargetGameId !== null)
                    .map((row) => Number(row.boundTargetGameId)),
            ),
        ];
        const games = new Map<number, GuildChainDto["boundGame"]>();
        if (boundGameIds.length > 0) {
            const rows: Array<{
                id: number;
                name: string;
                slug: string | null;
                coverUrl: string | null;
            }> = await this.dataSource.query(
                `SELECT g.id, g.name, g.slug, gc.url AS coverUrl
                 FROM game g
                 LEFT JOIN game_cover gc ON gc.gameId = g.id
                 WHERE g.id IN (${boundGameIds.map(() => "?").join(",")})`,
                boundGameIds,
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

        const finalKeys = GUILD_QUEST_CHAINS.flatMap(
            (chain) => GUILD_CHAIN_FINAL_REWARDS[chain.chainKey] ?? [],
        );
        const finalRewardRows = await this.dataSource
            .getRepository(GuildReward)
            .find({ where: { key: In([...finalKeys]) } });
        const finalByKey = new Map(
            finalRewardRows.map((reward) => [reward.key, reward]),
        );

        return GUILD_QUEST_CHAINS.map((definition) => {
            const progress = progressByKey.get(definition.chainKey);
            const boundTargetGameId =
                progress?.boundTargetGameId == null
                    ? null
                    : Number(progress.boundTargetGameId);
            const status: GuildChainListStatus = progress
                ? progress.status === GuildChainStatus.COMPLETED
                    ? GuildChainListStatus.COMPLETED
                    : GuildChainListStatus.IN_PROGRESS
                : guildRankAtLeast(rank, definition.minRank)
                  ? GuildChainListStatus.AVAILABLE
                  : GuildChainListStatus.LOCKED;

            return {
                chainKey: definition.chainKey,
                titleKey: definition.titleKey,
                minRank: definition.minRank,
                status,
                currentStageIndex: Number(progress?.currentStageIndex ?? 0),
                totalStages: definition.stages.length,
                boundTargetGameId,
                boundGame:
                    boundTargetGameId === null
                        ? null
                        : (games.get(boundTargetGameId) ?? null),
                activeContractId: progress?.activeContractId ?? null,
                stages: definition.stages.map(
                    (stage, index): GuildChainStageDto => ({
                        index,
                        stageKey: stage.stageKey,
                        objectiveType: stage.objectiveType,
                        targetCount: stage.targetCount,
                        criteria: stage.criteria,
                        xpReward: stage.xpReward,
                        sealsReward: stage.sealsReward,
                        durationDays: stage.durationDays,
                        usesBoundTargetGame: stage.usesBoundTargetGame,
                    }),
                ),
                finalRewards: (
                    GUILD_CHAIN_FINAL_REWARDS[definition.chainKey] ?? []
                )
                    .map((key) => finalByKey.get(key))
                    .filter((reward): reward is GuildReward => !!reward)
                    .map(toRewardDescriptor),
                finalBonusSeals: definition.finalBonusSeals,
            };
        });
    }

    private definitionOrFail(chainKey: GuildChainKey): GuildChainDefinition {
        const definition = CHAIN_BY_KEY.get(chainKey);
        if (!definition) throw new NotFoundException("Guild chain not found.");
        return definition;
    }

    /** Race-safe lazy membership, then the design-6 `guild_profile` row lock. */
    private async lockProfile(
        manager: EntityManager,
        userId: string,
    ): Promise<GuildProfile> {
        const [locked] = await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        if (!locked) {
            await manager.query(
                "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
                [userId],
            );
            await manager.query(
                "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
                [userId],
            );
        }
        return manager
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });
    }
}
