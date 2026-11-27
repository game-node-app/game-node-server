import { Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { dailyToday } from "../daily/daily.constants";
import { Profile } from "../profile/entities/profile.entity";
import { RecapGoalsService } from "../recap/recap-goals.service";
import {
    GuildBoardSeenResponseDto,
    GuildLicenseDto,
    GuildLicenseStatsDto,
    GuildYearGoalDto,
} from "./dto/guild-profile.dto";
import { GuildProfile } from "./entities/guild-profile.entity";
import { resolveActiveContractLimit } from "./guild-chains.service";
import {
    computeGuildPrestige,
    computeGuildRank,
    currentWeekStart,
    getGuildRankPerks,
} from "./guild.constants";
import { GuildRankProgressionService } from "./guild-rank-progression.service";

/** Visits closer together than this don't rewrite lastVisitedAt (design 17). */
const LAST_VISITED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class GuildProfileService {
    constructor(
        @InjectRepository(GuildProfile)
        private readonly guildProfileRepository: Repository<GuildProfile>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        private readonly dataSource: DataSource,
        private readonly recapGoalsService: RecapGoalsService,
        @Optional()
        private readonly rankProgressionService?: GuildRankProgressionService,
    ) {}

    /**
     * Race-safe lazy membership: concurrent first visits keep the first license number.
     * Reads first so an existing member costs a single SELECT (design 17).
     */
    public async ensureProfile(
        userId: string,
        manager?: EntityManager,
    ): Promise<GuildProfile> {
        const executor = manager ?? this.dataSource.manager;
        const repository = executor.getRepository(GuildProfile);
        const existing = await repository.findOneBy({ profileUserId: userId });
        if (existing) return existing;
        await executor.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        return repository.findOneByOrFail({ profileUserId: userId });
    }

    public async getLicense(
        userId: string,
        guildProfile?: GuildProfile,
        now = new Date(),
    ): Promise<GuildLicenseDto> {
        const [member, profile, stats] = await Promise.all([
            guildProfile ?? this.ensureProfile(userId),
            this.profileRepository.findOneByOrFail({ userId }),
            this.getStats(userId),
        ]);
        // Pre-migration members get any missed Rank packages on their first read.
        await this.rankProgressionService?.reconcileRankPromotionsIfNeeded(
            userId,
        );

        const rankProgress = computeGuildRank(member.xp);
        const { rank } = rankProgress;
        return {
            licenseNumber: member.licenseNumber,
            xp: member.xp,
            ...rankProgress,
            memberSince: profile.createdAt,
            equippedTitleKey: profile.guildTitleKey,
            equippedFrameKey: profile.guildFrameKey,
            sealsBalance: member.sealsBalance,
            ...computeGuildPrestige(member.xp),
            perks: {
                ...getGuildRankPerks(rank),
                maxActiveContracts: resolveActiveContractLimit(
                    rank,
                    member.extraSlotPermitWeekStart,
                    currentWeekStart(now),
                ),
            },
            equippedLicenseThemeKey: member.equippedLicenseThemeKey,
            equippedStampStyleKey: member.equippedStampStyleKey,
            equippedDecorKeys: member.equippedDecorKeys ?? [],
            showcaseBadgeIds: member.showcaseBadgeIds ?? [],
            stats,
        };
    }

    /** Null when the user has no goal configured for the current year. */
    public async getCurrentYearGoal(
        userId: string,
        now = new Date(),
    ): Promise<GuildYearGoalDto | null> {
        const year = Number(dailyToday(now).slice(0, 4));
        const goal = await this.recapGoalsService.getGoal(userId, year);
        return goal.target === null
            ? null
            : { year: goal.year, target: goal.target, finished: goal.finished };
    }

    public async markBoardSeen(
        userId: string,
        now = new Date(),
    ): Promise<GuildBoardSeenResponseDto> {
        await this.ensureProfile(userId);
        await this.guildProfileRepository.update(
            { profileUserId: userId },
            { lastBoardSeenAt: now },
        );
        return { hasUnseenBoard: false, lastBoardSeenAt: now };
    }

    public async touchLastVisitedAt(
        userId: string,
        now = new Date(),
    ): Promise<void> {
        await this.guildProfileRepository
            .createQueryBuilder()
            .update(GuildProfile)
            .set({ lastVisitedAt: now })
            .where("profileUserId = :userId", { userId })
            .andWhere("(lastVisitedAt IS NULL OR lastVisitedAt < :cutoff)", {
                cutoff: new Date(
                    now.getTime() - LAST_VISITED_WRITE_INTERVAL_MS,
                ),
            })
            .execute();
    }

    private async getStats(userId: string): Promise<GuildLicenseStatsDto> {
        const [row] = await this.dataSource.query(
            `SELECT
                (SELECT COUNT(*) FROM collection_entry WHERE libraryUserId = ? AND status = ?) AS finishedGames,
                (SELECT COUNT(*) FROM collection_entry WHERE libraryUserId = ? AND status = ?) AS backlogGames,
                (SELECT COUNT(*) FROM review WHERE profileUserId = ?) AS reviewsCount`,
            [
                userId,
                CollectionEntryStatus.FINISHED,
                userId,
                CollectionEntryStatus.PLANNED,
                userId,
            ],
        );

        return {
            finishedGames: Number(row.finishedGames),
            backlogGames: Number(row.backlogGames),
            reviewsCount: Number(row.reviewsCount),
        };
    }
}
