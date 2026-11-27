import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { DAILY_TIME_ZONE } from "../daily/daily.constants";
import { GuildBountiesService } from "./guild-bounties.service";
import { GuildContractEvaluatorService } from "./guild-contract-evaluator.service";
import { GuildContractRemindersService } from "./guild-contract-reminders.service";
import { DAY_MS } from "./guild.constants";
import {
    GUILD_TTB_TTL_DAYS,
    GuildTimeToBeatService,
} from "./guild-time-to-beat.service";

/** Only members who visited this recently get their backlog warmed (design 7). */
const ACTIVE_MEMBER_DAYS = 30;

/** Uncached or stale game IDs inspected per hourly tick. */
const PREFETCH_BATCH = 80;

/** `GuildTimeToBeatService` also caps each call at 40 IDs; chunk to that. */
const PREFETCH_CHUNK = 40;

@Injectable()
export class GuildScheduler {
    private readonly logger = new Logger(GuildScheduler.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly evaluatorService: GuildContractEvaluatorService,
        private readonly remindersService: GuildContractRemindersService,
        @Optional()
        private readonly guildTimeToBeatService?: GuildTimeToBeatService,
        @Optional()
        private readonly guildBountiesService?: GuildBountiesService,
    ) {}

    @Cron("15 * * * *", { timeZone: DAILY_TIME_ZONE })
    async hourlyTick(): Promise<void> {
        try {
            await this.evaluatorService.expireOverdueContracts();
        } catch (error) {
            this.logger.error(
                `Guild contract expiration failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        try {
            await this.remindersService.notifyExpiring();
        } catch (error) {
            this.logger.error(
                `Guild contract expiry reminders failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /** Bounded Community Bounty ready fan-out (design 6). */
    @Cron("5 * * * *", { timeZone: DAILY_TIME_ZONE })
    async communityBountyReadyTick(): Promise<void> {
        try {
            const queued =
                await this.guildBountiesService?.fanOutReadyNotifications();
            if (queued) {
                this.logger.log(
                    `Queued ${queued} Guild Community Bounty ready notification(s).`,
                );
            }
        } catch (error) {
            this.logger.error(
                `Guild Community Bounty ready fan-out failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /**
     * Bounded background time-to-beat prefetch for active Guild members' planned
     * and playing games, so board generation stays off the IGDB hot path.
     */
    @Cron("45 * * * *", { timeZone: DAILY_TIME_ZONE })
    async timeToBeatPrefetchTick(): Promise<void> {
        try {
            await this.prefetchTimeToBeatForActiveMembers();
        } catch (error) {
            this.logger.error(
                `Guild TTB prefetch failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /** Returns how many backlog game IDs this tick asked the cache to warm. */
    public async prefetchTimeToBeatForActiveMembers(
        now = new Date(),
    ): Promise<number> {
        if (!this.guildTimeToBeatService) return 0;

        const staleBefore = new Date(
            now.getTime() - GUILD_TTB_TTL_DAYS * DAY_MS,
        );
        const activeSince = new Date(
            now.getTime() - ACTIVE_MEMBER_DAYS * DAY_MS,
        );
        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT DISTINCT ce.gameId
             FROM collection_entry ce
             INNER JOIN guild_profile gp ON gp.profileUserId = ce.libraryUserId
             LEFT JOIN game_time_to_beat ttb ON ttb.gameId = ce.gameId
             WHERE ce.status IN (?, ?)
               AND gp.lastVisitedAt IS NOT NULL AND gp.lastVisitedAt >= ?
               AND (ttb.fetchedAt IS NULL OR ttb.fetchedAt < ?)
             ORDER BY ce.gameId ASC
             LIMIT ?`,
            [
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.PLAYING,
                activeSince,
                staleBefore,
                PREFETCH_BATCH,
            ],
        );

        let attempted = 0;
        for (let index = 0; index < rows.length; index += PREFETCH_CHUNK) {
            const chunk = rows
                .slice(index, index + PREFETCH_CHUNK)
                .map((row) => Number(row.gameId));
            try {
                // getForGameIds already swallows IGDB failures; this guards the cache write too.
                await this.guildTimeToBeatService.getForGameIds(chunk, now);
                attempted += chunk.length;
            } catch (error) {
                this.logger.warn(
                    `Guild TTB prefetch skipped ${chunk.length} game(s): ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
        return attempted;
    }
}
