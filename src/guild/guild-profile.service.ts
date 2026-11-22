import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { Profile } from "../profile/entities/profile.entity";
import { RecapGoalsService } from "../recap/recap-goals.service";
import {
    GuildBoardSeenResponseDto,
    GuildLicenseDto,
    GuildLicenseStatsDto,
    GuildYearGoalDto,
} from "./dto/guild-profile.dto";
import { GuildProfile } from "./entities/guild-profile.entity";
import { computeGuildRank } from "./guild.constants";

@Injectable()
export class GuildProfileService {
    constructor(
        @InjectRepository(GuildProfile)
        private readonly guildProfileRepository: Repository<GuildProfile>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        private readonly dataSource: DataSource,
        private readonly recapGoalsService: RecapGoalsService,
    ) {}

    /** Race-safe lazy membership: concurrent first visits keep the first license number. */
    public async ensureProfile(
        userId: string,
        manager?: EntityManager,
    ): Promise<GuildProfile> {
        const executor = manager ?? this.dataSource.manager;
        await executor.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        return executor
            .getRepository(GuildProfile)
            .findOneByOrFail({ profileUserId: userId });
    }

    public async getLicense(
        userId: string,
        guildProfile?: GuildProfile,
    ): Promise<GuildLicenseDto> {
        const [member, profile, stats] = await Promise.all([
            guildProfile ?? this.ensureProfile(userId),
            this.profileRepository.findOneByOrFail({ userId }),
            this.getStats(userId),
        ]);

        return {
            licenseNumber: member.licenseNumber,
            xp: member.xp,
            ...computeGuildRank(member.xp),
            memberSince: profile.createdAt,
            equippedTitleKey: profile.guildTitleKey,
            equippedFrameKey: profile.guildFrameKey,
            stats,
        };
    }

    /** Null when the user has no goal configured for the current year. */
    public async getCurrentYearGoal(
        userId: string,
        now = new Date(),
    ): Promise<GuildYearGoalDto | null> {
        const year = now.getUTCFullYear();
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
        await this.guildProfileRepository.update(
            { profileUserId: userId },
            { lastVisitedAt: now },
        );
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
