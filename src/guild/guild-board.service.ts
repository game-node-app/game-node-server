import { createHash, randomUUID } from "node:crypto";
import {
    ConflictException,
    Injectable,
    NotFoundException,
    Optional,
} from "@nestjs/common";
import {
    DataSource,
    EntityManager,
    In,
    LessThanOrEqual,
    MoreThan,
} from "typeorm";
import {
    GuildBoardCandidateGame,
    GuildBoardEntry,
} from "./entities/guild-board-entry.entity";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildReward } from "./entities/guild-reward.entity";
import {
    computeGuildRank,
    currentMonthKey,
    currentWeekStart,
    getGuildRankPerks,
    GUILD_BONUS_REVIEW_MIN_CHARS,
    GUILD_BONUS_STALE_DAYS,
    GUILD_RANK_ORDER,
    GuildBoardCycle,
    GuildBonusObjective,
    GuildBonusObjectiveType,
    GuildCategory,
    GuildContractStatus,
    GuildConsumableKey,
    GuildCriteria,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRank,
    guildRankAtLeast,
    igdbImageUrl,
    nextMondayRefreshAt,
    nextMonthResetAt,
    seededOrder,
    toRewardDescriptor,
} from "./guild.constants";
import {
    GUILD_SYSTEM_TEMPLATES,
    GuildQuestTemplate,
} from "./guild-templates.constants";
import {
    GuildProceduralBoardService,
    GuildResolvedTemplate,
} from "./guild-procedural-board.service";
import { GuildSealsService } from "./guild-seals.service";
import { GuildTimeToBeatService } from "./guild-time-to-beat.service";
import {
    GuildBoardEventTranslationDto,
    GuildBoardQuestDto,
    GuildBoardQuestMetaDto,
    GuildBoardResponseDto,
    RerollGuildBoardEntryResponseDto,
} from "./dto/guild-board.dto";

/** A complete weekly board always has three quest slots. */
const WEEKLY_BOARD_SLOT_COUNT = 3;

/** Weekly template category -> automatic slot (Design 3 keeps the slot layout). */
const WEEKLY_SLOT_BY_CATEGORY: Partial<Record<GuildCategory, number>> = {
    [GuildCategory.LIBRARY]: 0,
    [GuildCategory.WEEKLY]: 1,
    [GuildCategory.GAMENODE]: 2,
};

/** The 24-template weekly pool; Monthly Expeditions are generated separately. */
const WEEKLY_CATALOG = GUILD_SYSTEM_TEMPLATES.filter(
    (template) => template.cycle === GuildBoardCycle.WEEKLY,
);

const BONUS_OBJECTIVES: Record<GuildBonusObjectiveType, GuildBonusObjective> = {
    also_write_review: {
        type: "also_write_review",
        minChars: GUILD_BONUS_REVIEW_MIN_CHARS,
        bonusXp: 40,
        bonusSeals: 15,
    },
    finish_before_half_deadline: {
        type: "finish_before_half_deadline",
        bonusXp: 30,
        bonusSeals: 10,
    },
    use_stale_backlog_game: {
        type: "use_stale_backlog_game",
        staleDays: GUILD_BONUS_STALE_DAYS,
        bonusXp: 25,
        bonusSeals: 10,
        upgradeChestTier: true,
    },
};

/** Objectives a bonus objective can ride on without changing the quest. */
const BONUS_TYPES_BY_OBJECTIVE: Partial<
    Record<GuildObjectiveType, readonly GuildBonusObjectiveType[]>
> = {
    [GuildObjectiveType.FINISH_GAME]: [
        "also_write_review",
        "finish_before_half_deadline",
        "use_stale_backlog_game",
    ],
    [GuildObjectiveType.WRITE_REVIEW]: ["finish_before_half_deadline"],
};

const TEMPLATE_BY_KEY = new Map(
    GUILD_SYSTEM_TEMPLATES.map((template) => [template.key, template]),
);

/** Design 15: deterministic per-user weekly seed for template rotation and chips. */
const weekSeed = (userId: string, weekStart: string) =>
    createHash("sha256").update(`${userId}:${weekStart}`).digest();

const toDateString = (value: unknown): string | null =>
    value instanceof Date
        ? value.toISOString().slice(0, 10)
        : value == null
          ? null
          : String(value).slice(0, 10);

interface BoardSlot {
    slotIndex: number;
    template: GuildQuestTemplate;
    candidateGames: GuildBoardCandidateGame[];
    criteria: GuildCriteria;
    meta: Record<string, unknown> | null;
    bonusObjective: GuildBonusObjective | null;
}

interface GuildMemberState {
    rank: GuildRank;
    freeRerollWeekStart: string | null;
    freeRerollsUsedThisWeek: number;
}

interface RerollReplacement {
    template: GuildQuestTemplate;
    criteria: GuildCriteria;
    candidateGames: GuildBoardCandidateGame[];
    meta: Record<string, unknown> | null;
    bonusObjective: GuildBonusObjective | null;
    rewardId: string | null;
}

interface GameChip {
    name: string;
    slug: string;
    coverUrl: string | null;
}

export interface GetGuildBoardOptions {
    quick?: boolean;
    now?: Date;
}

/**
 * Builds each user's persisted Monday quest board, generates the Monthly
 * Expedition, and merges active curated events on read (design 3, 8).
 */
@Injectable()
export class GuildBoardService {
    private readonly proceduralBoardService: GuildProceduralBoardService;
    private readonly sealsService: GuildSealsService;

    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
        @Optional() proceduralBoardService?: GuildProceduralBoardService,
        @Optional() sealsService?: GuildSealsService,
    ) {
        // Optional so existing direct constructions (and module wiring before
        // GuildProceduralBoardService/GuildSealsService are registered) keep working.
        this.proceduralBoardService =
            proceduralBoardService ??
            new GuildProceduralBoardService(dataSource, guildTimeToBeatService);
        this.sealsService = sealsService ?? new GuildSealsService(dataSource);
    }

    public async ensureWeeklyEntries(
        userId: string,
        now = new Date(),
    ): Promise<GuildBoardEntry[]> {
        const { rank } = await this.memberState(userId);
        return this.ensureWeeklyEntriesForRank(userId, now, rank);
    }

    public async getBoard(
        userId: string,
        options: GetGuildBoardOptions = {},
    ): Promise<GuildBoardResponseDto> {
        const now = options.now ?? new Date();
        const weekStart = currentWeekStart(now);
        const member = await this.memberState(userId);
        const perks = getGuildRankPerks(member.rank);
        const entries = await this.boardEntries(userId, now, member.rank);
        const events = await this.activeEvents(now);
        const excluded = await this.excludedQuestKeys(
            userId,
            entries.map((entry) => entry.id),
            events.map((event) => event.id),
        );

        const openEntries = entries.filter(
            (entry) => !excluded.boardEntryIds.has(entry.id),
        );
        const openEvents = events.filter(
            (event) => !excluded.eventIds.has(event.id),
        );
        const chips = await this.gameChips(
            openEntries.flatMap((entry) => entry.candidateGames ?? []),
        );

        const quests: GuildBoardQuestDto[] = [
            ...openEntries.map((entry) => this.entryToQuest(entry, chips)),
            ...openEvents.map((event) => this.eventToQuest(event)),
        ];
        this.applyRecommendation(quests);

        const consumables =
            await this.sealsService.getConsumableBalances(userId);
        const board = {
            weekStart,
            nextRefreshAt: nextMondayRefreshAt(weekStart),
            rerollsRemaining: Math.max(
                0,
                perks.weeklyRerolls -
                    (member.freeRerollWeekStart === weekStart
                        ? member.freeRerollsUsedThisWeek
                        : 0),
            ),
            rerollChartersOwned: consumables[GuildConsumableKey.REROLL_CHARTER],
            monthlyExpeditionLocked: !perks.monthlyExpedition,
        };

        if (!options.quick) return { ...board, quests };

        return {
            ...board,
            quests: quests
                .filter((quest) => quest.isQuick)
                .sort(
                    (a, b) =>
                        GUILD_RANK_ORDER[a.rank] - GUILD_RANK_ORDER[b.rank],
                ),
        };
    }

    /** Open quest count for `GET /v1/guild`, sharing the board's exclusion rules (design 17). */
    public async getOpenBoardCount(
        userId: string,
        now = new Date(),
    ): Promise<number> {
        const { rank } = await this.memberState(userId);
        const entries = await this.boardEntries(userId, now, rank);
        const eventIds = (
            await this.dataSource.getRepository(GuildEvent).find({
                where: this.activeEventsWhere(now),
                select: { id: true },
            })
        ).map((event) => event.id);
        const excluded = await this.excludedQuestKeys(
            userId,
            entries.map((entry) => entry.id),
            eventIds,
        );
        return (
            entries.filter((entry) => !excluded.boardEntryIds.has(entry.id))
                .length +
            eventIds.filter((id) => !excluded.eventIds.has(id)).length
        );
    }

    /**
     * Replaces one open weekly slot with another eligible template, spending a
     * free rank reroll or a `reroll_charter` (spec: quest board reroll).
     */
    public async rerollEntry(
        userId: string,
        entryId: string,
        now = new Date(),
    ): Promise<RerollGuildBoardEntryResponseDto> {
        const weekStart = currentWeekStart(now);
        const repository = this.dataSource.getRepository(GuildBoardEntry);
        const entry = await repository.findOne({
            where: { id: entryId, profileUserId: userId },
        });
        if (!entry)
            throw new NotFoundException({
                message: "Board quest not found.",
                code: "guild_board_entry_not_found",
            });
        this.assertRerollable(entry, weekStart);

        const { rank } = await this.memberState(userId);
        // shortcut: the replacement resolves before the profile lock so IGDB never
        // runs inside the transaction; a double-click may repeat one replacement.
        const replacement = await this.resolveRerollReplacement(
            userId,
            entry,
            rank,
            now,
        );

        const outcome = await this.dataSource.transaction(async (manager) => {
            await this.lockProfile(manager, userId);
            const [profile] = await manager.query(
                "SELECT xp, freeRerollWeekStart, freeRerollsUsedThisWeek FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
                [userId],
            );
            // Lock the entry before spending an allowance so accepts serialize with rerolls.
            await manager.query(
                "SELECT id FROM guild_board_entry WHERE id = ? AND profileUserId = ? FOR UPDATE",
                [entry.id, userId],
            );
            const current = await manager
                .getRepository(GuildBoardEntry)
                .findOneByOrFail({ id: entry.id, profileUserId: userId });
            this.assertRerollable(current, weekStart);

            const lockedRank = computeGuildRank(Number(profile?.xp ?? 0)).rank;
            const perks = getGuildRankPerks(lockedRank);
            const [accepted] = await manager.query(
                `SELECT 1 AS ok FROM guild_contract
                 WHERE profileUserId = ? AND boardEntryId = ? AND status IN (?, ?, ?)
                 LIMIT 1`,
                [
                    userId,
                    entry.id,
                    GuildContractStatus.ACTIVE,
                    GuildContractStatus.READY_TO_CLAIM,
                    GuildContractStatus.COMPLETED,
                ],
            );
            if (accepted)
                throw new ConflictException({
                    message: "Accepted board quests cannot be rerolled.",
                    code: "guild_reroll_not_available",
                });

            const used =
                toDateString(profile?.freeRerollWeekStart) === weekStart
                    ? Number(profile?.freeRerollsUsedThisWeek ?? 0)
                    : 0;
            const freeUsed = used < perks.weeklyRerolls;
            let consumableUsed: GuildConsumableKey | null = null;

            if (freeUsed) {
                await manager.query(
                    "UPDATE guild_profile SET freeRerollWeekStart = ?, freeRerollsUsedThisWeek = ? WHERE profileUserId = ?",
                    [weekStart, used + 1, userId],
                );
            } else {
                try {
                    await this.sealsService.consumeConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.REROLL_CHARTER,
                    );
                } catch (error) {
                    if (error instanceof ConflictException)
                        throw new ConflictException({
                            message:
                                "No free rerolls or reroll charters remain.",
                            code: "guild_reroll_unavailable",
                        });
                    throw error;
                }
                consumableUsed = GuildConsumableKey.REROLL_CHARTER;
            }

            await manager.query(
                `UPDATE guild_board_entry
                 SET templateKey = ?, \`rank\` = ?, xpReward = ?, sealsReward = ?,
                     objectiveType = ?, targetCount = ?, criteria = ?, candidateGames = ?,
                     requiresTargetGame = ?, rewardId = ?, isQuick = ?, bonusObjective = ?,
                     meta = ?, rerollCount = ?
                 WHERE id = ? AND profileUserId = ?`,
                [
                    replacement.template.key,
                    replacement.template.rank,
                    replacement.template.xpReward,
                    replacement.template.sealsReward,
                    replacement.template.objectiveType,
                    replacement.template.targetCount,
                    JSON.stringify(replacement.criteria),
                    JSON.stringify(replacement.candidateGames),
                    replacement.template.requiresTargetGame,
                    replacement.rewardId,
                    replacement.template.isQuick,
                    replacement.bonusObjective
                        ? JSON.stringify(replacement.bonusObjective)
                        : null,
                    replacement.meta ? JSON.stringify(replacement.meta) : null,
                    current.rerollCount + 1,
                    current.id,
                    userId,
                ],
            );

            const consumables = await this.sealsService.getConsumableBalances(
                userId,
                manager,
            );
            return {
                rerollsRemaining: Math.max(
                    0,
                    perks.weeklyRerolls - (freeUsed ? used + 1 : used),
                ),
                rerollChartersOwned:
                    consumables[GuildConsumableKey.REROLL_CHARTER],
                consumableUsed,
            };
        });

        const updated = await repository.findOne({
            where: { id: entry.id },
            relations: { reward: true },
        });
        const chips = await this.gameChips(updated?.candidateGames ?? []);
        return { quest: this.entryToQuest(updated!, chips), ...outcome };
    }

    private async resolveRerollReplacement(
        userId: string,
        entry: GuildBoardEntry,
        rank: GuildRank,
        now: Date,
    ): Promise<RerollReplacement> {
        const weekStart = currentWeekStart(now);
        const siblingRows: Array<{ templateKey: string }> =
            await this.dataSource.query(
                "SELECT templateKey FROM guild_board_entry WHERE profileUserId = ? AND cycle = ? AND periodKey = ? AND slotIndex <> ?",
                [userId, GuildBoardCycle.WEEKLY, weekStart, entry.slotIndex],
            );
        const siblingKeys = new Set(
            siblingRows.map((row) => String(row.templateKey)),
        );
        const rerollSeed = createHash("sha256")
            .update(
                `${userId}:${weekStart}:${entry.id}:${entry.rerollCount + 1}`,
            )
            .digest();
        const pool = WEEKLY_CATALOG.filter(
            (template) =>
                template.category === entry.category &&
                guildRankAtLeast(rank, template.minRank) &&
                template.key !== entry.templateKey,
        );
        const preferred = pool.filter(
            (template) => !siblingKeys.has(template.key),
        );
        const eligible = await this.proceduralBoardService.resolveTemplates(
            userId,
            preferred.length > 0 ? preferred : pool,
            { now, seed: rerollSeed },
        );
        const winner = seededOrder(
            rerollSeed,
            eligible,
            (item) => item.template.key,
        )[0];
        if (!winner)
            throw new ConflictException({
                message: "No alternative quest is available.",
                code: "guild_reroll_unavailable",
            });

        const rewardIds = await this.rewardIdsByKey([
            winner.template.rewardKey,
        ]);
        return {
            template: winner.template,
            criteria: winner.criteria,
            candidateGames: winner.candidateGames,
            meta: winner.meta,
            bonusObjective: this.bonusObjectiveFor(rerollSeed, winner.template),
            rewardId: rewardIds.get(winner.template.rewardKey ?? "") ?? null,
        };
    }

    private assertRerollable(entry: GuildBoardEntry, weekStart: string): void {
        if (
            entry.cycle !== GuildBoardCycle.WEEKLY ||
            entry.weekStart !== weekStart ||
            entry.slotIndex >= WEEKLY_BOARD_SLOT_COUNT
        )
            throw new ConflictException({
                message: "Only open weekly board quests can be rerolled.",
                code: "guild_reroll_not_available",
            });
    }

    private async ensureWeeklyEntriesForRank(
        userId: string,
        now: Date,
        rank: GuildRank,
    ): Promise<GuildBoardEntry[]> {
        const weekStart = currentWeekStart(now);
        const repository = this.dataSource.getRepository(GuildBoardEntry);
        const existing = await repository.find({
            where: {
                profileUserId: userId,
                cycle: GuildBoardCycle.WEEKLY,
                periodKey: weekStart,
            },
            relations: { reward: true },
            order: { slotIndex: "ASC" },
        });
        // A partial board (an earlier request died mid-insert) is topped up below.
        if (existing.length >= WEEKLY_BOARD_SLOT_COUNT) return existing;

        const seed = weekSeed(userId, weekStart);
        const catalog = WEEKLY_CATALOG.filter((template) =>
            guildRankAtLeast(rank, template.minRank),
        );
        const eligible = await this.proceduralBoardService.resolveTemplates(
            userId,
            catalog,
            { now, seed },
        );
        const slots = this.weeklySlots(seed, eligible);
        const rewardIds = await this.rewardIdsByKey(
            slots.map((slot) => slot.template.rewardKey),
        );
        const expiresAt = nextMondayRefreshAt(weekStart);

        // One transaction, so a killed request or failed slot never leaves a partial board for the week.
        // INSERT IGNORE keeps concurrent same-week generation idempotent (UQ user/cycle/period/slot).
        await this.dataSource.transaction(async (manager) => {
            for (const slot of slots) {
                await manager.query(
                    `INSERT IGNORE INTO guild_board_entry
                        (id, profileUserId, weekStart, cycle, periodKey, slotIndex, category, templateKey, \`rank\`, xpReward,
                         sealsReward, objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                         isRecommended, isQuick, bonusObjective, meta, rerollCount, expiresAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)`,
                    [
                        randomUUID(),
                        userId,
                        weekStart,
                        GuildBoardCycle.WEEKLY,
                        weekStart,
                        slot.slotIndex,
                        slot.template.category,
                        slot.template.key,
                        slot.template.rank,
                        slot.template.xpReward,
                        slot.template.sealsReward,
                        slot.template.objectiveType,
                        slot.template.targetCount,
                        JSON.stringify(slot.criteria),
                        JSON.stringify(slot.candidateGames),
                        slot.template.requiresTargetGame,
                        rewardIds.get(slot.template.rewardKey ?? "") ?? null,
                        slot.template.isQuick,
                        slot.bonusObjective
                            ? JSON.stringify(slot.bonusObjective)
                            : null,
                        slot.meta ? JSON.stringify(slot.meta) : null,
                        expiresAt,
                    ],
                );
            }
        });

        return repository.find({
            where: {
                profileUserId: userId,
                cycle: GuildBoardCycle.WEEKLY,
                periodKey: weekStart,
            },
            relations: { reward: true },
            order: { slotIndex: "ASC" },
        });
    }

    /**
     * Slot 0 holds a library-DNA quest, slot 1 a weekly quest and slot 2 a
     * GameNode quest. An empty library is filled by an unused weekly/GameNode
     * template so every member always has three quests.
     */
    private weeklySlots(
        seed: Buffer,
        eligible: GuildResolvedTemplate[],
    ): BoardSlot[] {
        const slots: BoardSlot[] = [];
        const used = new Set<string>();
        const take = (category: GuildCategory) => {
            const winner = seededOrder(
                seed,
                eligible.filter(
                    (item) =>
                        item.template.category === category &&
                        !used.has(item.template.key),
                ),
                (item) => item.template.key,
            )[0];
            if (!winner) return;
            used.add(winner.template.key);
            slots.push({
                slotIndex: WEEKLY_SLOT_BY_CATEGORY[category]!,
                template: winner.template,
                candidateGames: winner.candidateGames,
                criteria: winner.criteria,
                meta: winner.meta,
                bonusObjective: this.bonusObjectiveFor(seed, winner.template),
            });
        };

        take(GuildCategory.LIBRARY);
        take(GuildCategory.WEEKLY);
        take(GuildCategory.GAMENODE);

        if (!slots.some((slot) => slot.slotIndex === 0)) {
            const fallback = seededOrder(
                seed,
                eligible.filter(
                    (item) =>
                        !used.has(item.template.key) &&
                        (item.template.category === GuildCategory.WEEKLY ||
                            item.template.category === GuildCategory.GAMENODE),
                ),
                (item) => item.template.key,
            )[0];
            if (fallback) {
                used.add(fallback.template.key);
                slots.push({
                    slotIndex: 0,
                    template: fallback.template,
                    candidateGames: fallback.candidateGames,
                    criteria: fallback.criteria,
                    meta: fallback.meta,
                    bonusObjective: this.bonusObjectiveFor(
                        seed,
                        fallback.template,
                    ),
                });
            }
        }

        return slots.sort((a, b) => a.slotIndex - b.slotIndex);
    }

    /** ~50% of compatible weekly slots; the rest stay plain (design 4). */
    private bonusObjectiveFor(
        seed: Buffer,
        template: GuildQuestTemplate,
    ): GuildBonusObjective | null {
        const types = BONUS_TYPES_BY_OBJECTIVE[template.objectiveType];
        if (!types || seed[3] % 2 === 1) return null;
        return { ...BONUS_OBJECTIVES[types[seed[5] % types.length]] };
    }

    /** Persists the Rank C+ Monthly Expedition for the current São Paulo month. */
    private async ensureMonthlyEntry(
        userId: string,
        now: Date,
        rank: GuildRank,
    ): Promise<GuildBoardEntry | null> {
        if (!getGuildRankPerks(rank).monthlyExpedition) return null;

        const periodKey = currentMonthKey(now);
        const repository = this.dataSource.getRepository(GuildBoardEntry);
        const existing = await repository.findOne({
            where: {
                profileUserId: userId,
                cycle: GuildBoardCycle.MONTHLY,
                periodKey,
            },
            relations: { reward: true },
        });
        if (existing) return existing;

        const expedition =
            await this.proceduralBoardService.generateMonthlyExpedition(
                userId,
                rank,
                { now },
            );
        if (!expedition) return null;

        const rewardIds = await this.rewardIdsByKey([
            expedition.template.rewardKey,
        ]);
        await this.dataSource.query(
            `INSERT IGNORE INTO guild_board_entry
                (id, profileUserId, weekStart, cycle, periodKey, slotIndex, category, templateKey, \`rank\`, xpReward,
                 sealsReward, objectiveType, targetCount, criteria, candidateGames, requiresTargetGame, rewardId,
                 isRecommended, isQuick, bonusObjective, meta, rerollCount, expiresAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 0, ?)`,
            [
                randomUUID(),
                userId,
                `${periodKey}-01`,
                GuildBoardCycle.MONTHLY,
                periodKey,
                expedition.slotIndex,
                expedition.template.category,
                expedition.template.key,
                expedition.template.rank,
                expedition.template.xpReward,
                expedition.template.sealsReward,
                expedition.template.objectiveType,
                expedition.template.targetCount,
                JSON.stringify(expedition.criteria),
                JSON.stringify(expedition.candidateGames),
                expedition.template.requiresTargetGame,
                rewardIds.get(expedition.template.rewardKey ?? "") ?? null,
                expedition.template.isQuick,
                expedition.meta ? JSON.stringify(expedition.meta) : null,
                nextMonthResetAt(now),
            ],
        );

        return repository.findOne({
            where: {
                profileUserId: userId,
                cycle: GuildBoardCycle.MONTHLY,
                periodKey,
            },
            relations: { reward: true },
        });
    }

    private async boardEntries(
        userId: string,
        now: Date,
        rank: GuildRank,
    ): Promise<GuildBoardEntry[]> {
        const weekly = await this.ensureWeeklyEntriesForRank(userId, now, rank);
        const monthly = await this.ensureMonthlyEntry(userId, now, rank);
        return monthly ? [...weekly, monthly] : weekly;
    }

    private async memberState(userId: string): Promise<GuildMemberState> {
        const [row] = await this.dataSource.query(
            "SELECT xp, freeRerollWeekStart, freeRerollsUsedThisWeek FROM guild_profile WHERE profileUserId = ?",
            [userId],
        );
        return {
            rank: computeGuildRank(Number(row?.xp ?? 0)).rank,
            freeRerollWeekStart: toDateString(row?.freeRerollWeekStart),
            freeRerollsUsedThisWeek: Number(row?.freeRerollsUsedThisWeek ?? 0),
        };
    }

    /** Mirrors GuildSealsService.lockProfile so rerolls serialize with claim flows. */
    private async lockProfile(
        manager: EntityManager,
        userId: string,
    ): Promise<void> {
        const [locked] = await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        if (locked) return;
        await manager.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
    }

    private async rewardIdsByKey(
        keys: Array<string | null>,
    ): Promise<Map<string, string>> {
        const uniqueKeys = [
            ...new Set(keys.filter((key): key is string => key !== null)),
        ];
        if (uniqueKeys.length === 0) return new Map();

        const rewards = await this.dataSource
            .getRepository(GuildReward)
            .find({ where: { key: In(uniqueKeys), isActive: true } });
        return new Map(rewards.map((reward) => [reward.key, reward.id]));
    }

    private activeEventsWhere(now: Date) {
        return {
            status: GuildEventStatus.PUBLISHED,
            startsAt: LessThanOrEqual(now),
            endsAt: MoreThan(now),
        };
    }

    private activeEvents(now: Date): Promise<GuildEvent[]> {
        return this.dataSource.getRepository(GuildEvent).find({
            where: this.activeEventsWhere(now),
            relations: { translations: true, reward: true },
            order: { startsAt: "ASC", id: "ASC" },
        });
    }

    /** Contracts that close a quest: abandoned/expired leave it open (spec: quest board). */
    private async excludedQuestKeys(
        userId: string,
        boardEntryIds: string[],
        eventIds: string[],
    ): Promise<{ boardEntryIds: Set<string>; eventIds: Set<string> }> {
        const closedBoardEntryIds = new Set<string>();
        const closedEventIds = new Set<string>();

        if (boardEntryIds.length > 0 || eventIds.length > 0) {
            const clauses: string[] = [];
            const parameters: unknown[] = [
                userId,
                GuildContractStatus.ACTIVE,
                GuildContractStatus.READY_TO_CLAIM,
                GuildContractStatus.COMPLETED,
            ];
            if (boardEntryIds.length > 0) {
                clauses.push(
                    `boardEntryId IN (${boardEntryIds.map(() => "?").join(",")})`,
                );
                parameters.push(...boardEntryIds);
            }
            if (eventIds.length > 0) {
                clauses.push(
                    `eventId IN (${eventIds.map(() => "?").join(",")})`,
                );
                parameters.push(...eventIds);
            }
            const rows: Array<{
                boardEntryId: string | null;
                eventId: string | null;
            }> = await this.dataSource.query(
                `SELECT boardEntryId, eventId FROM guild_contract
                 WHERE profileUserId = ? AND status IN (?, ?, ?)
                   AND (${clauses.join(" OR ")})`,
                parameters,
            );
            for (const row of rows) {
                if (row.boardEntryId) closedBoardEntryIds.add(row.boardEntryId);
                if (row.eventId) closedEventIds.add(row.eventId);
            }
        }

        return {
            boardEntryIds: closedBoardEntryIds,
            eventIds: closedEventIds,
        };
    }

    private async gameChips(
        candidates: GuildBoardCandidateGame[],
    ): Promise<Map<number, GameChip>> {
        const gameIds = [...new Set(candidates.map((game) => game.gameId))];
        if (gameIds.length === 0) return new Map();

        const rows: Array<{
            id: number;
            name: string;
            slug: string;
            coverUrl: string | null;
        }> = await this.dataSource.query(
            `SELECT g.id, g.name, g.slug, gc.url AS coverUrl
             FROM game g
             LEFT JOIN game_cover gc ON gc.gameId = g.id
             WHERE g.id IN (${gameIds.map(() => "?").join(",")})`,
            gameIds,
        );
        return new Map(
            rows.map((row) => [
                Number(row.id),
                {
                    name: row.name,
                    slug: row.slug,
                    coverUrl: igdbImageUrl(
                        row.coverUrl ?? undefined,
                        "t_cover_big",
                    ),
                },
            ]),
        );
    }

    private entryToQuest(
        entry: GuildBoardEntry,
        chips: Map<number, GameChip>,
    ): GuildBoardQuestDto {
        const candidateGames = (entry.candidateGames ?? []).map((candidate) => {
            const game = chips.get(candidate.gameId);
            return {
                gameId: candidate.gameId,
                ...(game
                    ? {
                          name: game.name,
                          slug: game.slug,
                          coverUrl: game.coverUrl,
                      }
                    : {}),
                ...(candidate.sinceYear !== undefined
                    ? { sinceYear: candidate.sinceYear }
                    : {}),
                ...(candidate.estimatedHours !== undefined
                    ? { estimatedHours: candidate.estimatedHours }
                    : {}),
            };
        });
        const sinceYear = candidateGames[0]?.sinceYear ?? null;
        const meta = { ...(entry.meta ?? {}) } as GuildBoardQuestMetaDto;
        if (sinceYear !== null) meta.sinceYear = sinceYear;

        return {
            sourceType: "board_entry",
            boardEntryId: entry.id,
            eventId: null,
            slug: null,
            category: entry.category,
            cycle: entry.cycle,
            templateKey: entry.templateKey,
            title: null,
            description: null,
            translations: [],
            rank: entry.rank,
            xpReward: entry.xpReward,
            sealsReward: entry.sealsReward ?? 0,
            objectiveType: entry.objectiveType,
            targetCount: entry.targetCount,
            criteria: entry.criteria,
            candidateGames,
            meta: Object.keys(meta).length > 0 ? meta : null,
            bonusObjective: entry.bonusObjective ?? null,
            requiresTargetGame: entry.requiresTargetGame,
            reward: entry.reward ? toRewardDescriptor(entry.reward) : null,
            isRecommended: false,
            isQuick: entry.isQuick,
            rerollCount: entry.rerollCount ?? 0,
            contractDurationDays:
                TEMPLATE_BY_KEY.get(entry.templateKey)?.contractDurationDays ??
                null,
            expiresAt: entry.expiresAt,
        };
    }

    private eventToQuest(event: GuildEvent): GuildBoardQuestDto {
        const translations: GuildBoardEventTranslationDto[] = [
            ...(event.translations ?? []),
        ]
            .sort((a, b) => a.locale.localeCompare(b.locale))
            .map((translation) => ({
                locale: translation.locale,
                title: translation.title,
                description: translation.description,
            }));

        return {
            sourceType: "event",
            boardEntryId: null,
            eventId: event.id,
            slug: event.slug,
            category: GuildCategory.EVENT,
            cycle: null,
            templateKey: null,
            title: event.title,
            description: event.description,
            translations,
            rank: event.rank,
            xpReward: event.xpReward,
            sealsReward: event.sealsReward ?? 0,
            objectiveType: event.objectiveType,
            targetCount: event.targetCount,
            criteria: event.criteria,
            candidateGames: [],
            meta: null,
            bonusObjective: event.bonusObjective ?? null,
            requiresTargetGame: false,
            reward: event.reward ? toRewardDescriptor(event.reward) : null,
            isRecommended: false,
            isQuick: event.rank === GuildRank.E || event.rank === GuildRank.D,
            rerollCount: 0,
            contractDurationDays: null,
            expiresAt: event.endsAt,
        };
    }

    /** Library first, then an active event, then the first weekly quest (spec). */
    private applyRecommendation(quests: GuildBoardQuestDto[]): void {
        const recommended =
            quests.find(
                (quest) =>
                    quest.sourceType === "board_entry" &&
                    quest.category === GuildCategory.LIBRARY,
            ) ??
            quests.find((quest) => quest.sourceType === "event") ??
            quests.find((quest) => quest.category === GuildCategory.WEEKLY);
        if (recommended) recommended.isRecommended = true;
    }
}
