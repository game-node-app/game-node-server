import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import { AchievementsProgressService } from "../achievements/achievements-progress.service";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { LevelService } from "../level/level.service";
import {
    AcceptGuildContractDto,
    AcceptGuildContractResponseDto,
    ClaimGuildContractResponseDto,
    GetGuildContractsQueryDto,
    GuildContractDto,
    GuildContractEventSummaryDto,
    GuildContractPlaytimeProgressDto,
    GuildContractTargetGameDto,
    GuildContractsListResponseDto,
    GuildOverviewResponseDto,
} from "./dto/guild-contracts.dto";
import { GuildRewardDescriptorDto } from "./dto/guild-rewards.dto";
import { GuildBoardEntry } from "./entities/guild-board-entry.entity";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import {
    computeGuildRank,
    currentWeekStart,
    GUILD_MAX_ACTIVE_CONTRACTS,
    GuildCategory,
    GuildContractStatus,
    GuildCriteria,
    GuildEventStatus,
    GuildObjectiveType,
    LinaPose,
    LinaTrigger,
    nextMondayRefreshAt,
} from "./guild.constants";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildBoardService } from "./guild-board.service";
import { GuildProfileService } from "./guild-profile.service";
import { GuildRewardsService } from "./guild-rewards.service";
import {
    GuildTimeToBeatService,
    GUILD_TTB_TTL_DAYS,
    getEffectiveTtbSeconds,
} from "./guild-time-to-beat.service";
import { LinaReceptionService } from "./lina-reception.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stale backlog threshold shared with the board templates (design 3). */
const STALE_BACKLOG_DAYS = 365;

const CONTRACT_RELATIONS = {
    targetGame: true,
    reward: true,
    event: { translations: true },
} as const;

// IGDB stores protocol-relative URLs with the size in the path, like the board.
const igdbImageUrl = (url: string | undefined, size: string) => {
    if (!url) return null;
    const sized = url.replace(/\/t_[a-z0-9_]+\//, `/${size}/`);
    return sized.startsWith("//") ? `https:${sized}` : sized;
};

const toRewardDescriptor = (reward: GuildReward): GuildRewardDescriptorDto => ({
    id: reward.id,
    key: reward.key,
    kind: reward.kind,
    achievementId: reward.achievementId,
    inChestPool: reward.inChestPool,
    chestBonusXp: reward.chestBonusXp,
});

const rankOrder = (status: GuildContractStatus) =>
    status === GuildContractStatus.READY_TO_CLAIM ? 0 : 1;

/**
 * Player-facing contract lifecycle: acceptance with target validation,
 * listing, atomic turn-in and abandonment (designs 5 and 6).
 */
@Injectable()
export class GuildContractsService {
    private readonly logger = new Logger(GuildContractsService.name);

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
    ) {}

    public async getOverview(
        userId: string,
        now = new Date(),
    ): Promise<GuildOverviewResponseDto> {
        const guildProfile =
            await this.guildProfileService.ensureProfile(userId);
        await this.evaluatorService.evaluateUserContracts(userId, now);

        const weekStart = currentWeekStart(now);
        const [license, contracts, yearGoal, boardCount, completedCount] =
            await Promise.all([
                this.guildProfileService.getLicense(userId, guildProfile),
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
            { readyContract, now, updateLastVisited: true },
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
        if (
            dto.targetGameId != null &&
            (entry?.criteria ?? preReadEvent?.criteria)?.maxTimeToBeatHours !=
                null
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
                await manager.query(
                    "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
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
                if (entry && entry.weekStart !== currentWeekStart(acceptedAt)) {
                    throw new BadRequestException(
                        "This board quest is no longer available.",
                    );
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
                if (Number(countRow.total) >= GUILD_MAX_ACTIVE_CONTRACTS) {
                    throw new ConflictException({
                        message:
                            "You already hold the maximum of 3 active contracts.",
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
                await manager.getRepository(GuildContract).insert({
                    id: contractId,
                    profileUserId: userId,
                    boardEntryId: entry?.id ?? null,
                    eventId: event?.id ?? null,
                    category: entry?.category ?? GuildCategory.EVENT,
                    templateKey: entry?.templateKey ?? null,
                    rank: entry?.rank ?? event!.rank,
                    xpReward: entry?.xpReward ?? event!.xpReward,
                    objectiveType: entry?.objectiveType ?? event!.objectiveType,
                    criteria: entry?.criteria ?? event!.criteria,
                    targetGameId: dto.targetGameId ?? null,
                    progressCurrent: 0,
                    progressTarget: entry?.targetCount ?? event!.targetCount,
                    status: GuildContractStatus.ACTIVE,
                    rewardId: entry ? entry.rewardId : event!.rewardId,
                    claimPayload: null,
                    acceptedAt,
                    readyAt: null,
                    claimedAt: null,
                    expiresAt: entry ? entry.expiresAt : event!.endsAt,
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
            const rows: Array<{ id: string; status: GuildContractStatus }> =
                await manager.query(
                    "SELECT id, status FROM guild_contract WHERE id = ? AND profileUserId = ? FOR UPDATE",
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

            const fulfillment =
                await this.guildRewardsService.fulfillContractRewardWithManager(
                    manager,
                    userId,
                    contract.id,
                    contract.rewardId,
                    now,
                );

            const totalXp = contract.xpReward + fulfillment.bonusXp;
            const rankBefore = guildProfile.rank;
            const xpAfter = guildProfile.xp + totalXp;
            const rankAfter = computeGuildRank(xpAfter).rank;

            await manager.update(
                GuildProfile,
                { profileUserId: userId },
                { xp: xpAfter, rank: rankAfter },
            );
            await this.levelService.increaseExp(userId, totalXp, manager);

            const claimPayload = {
                xpAwarded: totalXp,
                rankBefore,
                rankAfter,
                unlockedRewards: fulfillment.unlockedRewards,
                chestResult: fulfillment.chestResult,
            };
            await manager.query(
                "UPDATE guild_contract SET status = ?, claimedAt = ?, claimPayload = ? WHERE id = ?",
                [
                    GuildContractStatus.COMPLETED,
                    now,
                    JSON.stringify(claimPayload),
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
                rankBefore,
                rankAfter,
                unlockedRewards: fulfillment.unlockedRewards,
                chestResult: fulfillment.chestResult,
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

        const lina = {
            trigger: LinaTrigger.CONTRACT_CLAIMED,
            pose: LinaPose.HAPPY,
            context: {
                contractId: outcome.contractDto.id,
                xpAwarded: outcome.totalXp,
                rankBefore: outcome.rankBefore,
                rankAfter: outcome.rankAfter,
                rankedUp: outcome.rankBefore !== outcome.rankAfter,
            },
            hasUnseenBoard: outcome.hasUnseenBoard,
        };

        return {
            contract: outcome.contractDto,
            xpAwarded: outcome.totalXp,
            rankBefore: outcome.rankBefore,
            rankAfter: outcome.rankAfter,
            unlockedRewards: outcome.unlockedRewards,
            chestResult: outcome.chestResult,
            lina,
        };
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

        const updated = await repository.findOneOrFail({
            where: { id: contractId },
            relations: CONTRACT_RELATIONS,
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
            if (libraryEntry?.status === CollectionEntryStatus.FINISHED) {
                throw new BadRequestException(
                    "This game is already finished in your library.",
                );
            }

            if (templateKey === "forgotten_relic") {
                await this.assertStaleBacklogGame(
                    userId,
                    targetGameId,
                    now,
                    manager,
                );
            } else if (templateKey === "deep_dive") {
                if (libraryEntry?.status !== CollectionEntryStatus.PLAYING) {
                    throw new BadRequestException(
                        "This quest requires a game you are currently playing.",
                    );
                }
            }
        }

        await this.assertGameMatchesCriteria(
            targetGameId,
            criteria,
            now,
            manager,
        );
    }

    private async assertStaleBacklogGame(
        userId: string,
        gameId: number,
        now: Date,
        manager: EntityManager,
    ): Promise<void> {
        const cutoff = new Date(now.getTime() - STALE_BACKLOG_DAYS * DAY_MS);
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

    private async assertGameMatchesCriteria(
        gameId: number,
        criteria: GuildCriteria,
        now: Date,
        manager: EntityManager,
    ): Promise<void> {
        if (criteria.gameIds?.length && !criteria.gameIds.includes(gameId)) {
            throw new BadRequestException(
                "This game does not match the quest criteria.",
            );
        }

        const relationChecks: Array<[string, string, number[] | undefined]> = [
            ["game_genres_game_genre", "gameGenreId", criteria.genreIds],
            ["game_themes_game_theme", "gameThemeId", criteria.themeIds],
            [
                "game_keywords_game_keyword",
                "gameKeywordId",
                criteria.keywordIds,
            ],
        ];
        for (const [table, column, values] of relationChecks) {
            if (!values?.length) continue;
            const [match] = await manager.query(
                `SELECT 1 AS ok FROM ${table}
                 WHERE gameId = ? AND ${column} IN (${values.map(() => "?").join(",")})
                 LIMIT 1`,
                [gameId, ...values],
            );
            if (!match) {
                throw new BadRequestException(
                    "This game does not match the quest criteria.",
                );
            }
        }

        if (criteria.maxTimeToBeatHours != null) {
            const [row] = await manager.query(
                "SELECT hastilySeconds, normallySeconds, fetchedAt FROM game_time_to_beat WHERE gameId = ?",
                [gameId],
            );
            // The pre-accept warm-up keeps this local; only a missing or stale row reaches IGDB.
            const fresh =
                row &&
                now.getTime() - new Date(row.fetchedAt).getTime() <
                    GUILD_TTB_TTL_DAYS * DAY_MS;
            const cached = fresh
                ? row
                : (
                      await this.guildTimeToBeatService.getForGameIds(
                          [gameId],
                          now,
                      )
                  ).get(gameId);
            const seconds = getEffectiveTtbSeconds(cached);
            if (
                seconds === null ||
                seconds <= 0 ||
                seconds > criteria.maxTimeToBeatHours * 60 * 60
            ) {
                throw new BadRequestException(
                    "This game does not match the quest criteria.",
                );
            }
        }
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
            objectiveType: contract.objectiveType,
            criteria: contract.criteria,
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
