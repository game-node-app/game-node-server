import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { IGDBTimeToBeatPlaytime } from "../sync/igdb/igdb.types";
import { IgdbPlaytimeSyncService } from "../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeat } from "./entities/game-time-to-beat.entity";

/** Days a cached IGDB time-to-beat row stays fresh, including negative entries. */
export const GUILD_TTB_TTL_DAYS = 30;

/** Most uncached or stale game IDs fetched from IGDB per call (design 4). */
export const GUILD_TTB_MAX_BATCH = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `normallySeconds` with `hastilySeconds` fallback, as the board templates expect. */
export function getEffectiveTtbSeconds(
    row:
        | Pick<GameTimeToBeat, "normallySeconds" | "hastilySeconds">
        | null
        | undefined,
): number | null {
    return row?.normallySeconds ?? row?.hastilySeconds ?? null;
}

/**
 * Local `game_time_to_beat` cache in front of IGDB, so board generation never
 * depends on IGDB availability or quota (design 4).
 */
@Injectable()
export class GuildTimeToBeatService {
    private readonly logger = new Logger(GuildTimeToBeatService.name);

    constructor(
        @InjectRepository(GameTimeToBeat)
        private readonly repository: Repository<GameTimeToBeat>,
        private readonly igdbPlaytimeSyncService: IgdbPlaytimeSyncService,
    ) {}

    public async getForGameIds(
        gameIds: number[],
        now: Date = new Date(),
    ): Promise<Map<number, GameTimeToBeat>> {
        const ids = [
            ...new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0)),
        ];
        const cached = new Map<number, GameTimeToBeat>();
        if (ids.length === 0) return cached;

        const rows = await this.repository.find({
            where: { gameId: In(ids) },
        });
        for (const row of rows) cached.set(row.gameId, row);

        const staleBefore = now.getTime() - GUILD_TTB_TTL_DAYS * DAY_MS;
        // shortcut: board generation inspects at most the 40 most recently added/oldest planned games for TTB cache misses per user; upgrade to a background IGDB TTB catalog sync job if short-game matching needs full-library coverage for 1,000+ game backlogs.
        const idsToFetch = ids
            .filter((id) => {
                const row = cached.get(id);
                return !row || row.fetchedAt.getTime() < staleBefore;
            })
            .slice(0, GUILD_TTB_MAX_BATCH);
        if (idsToFetch.length === 0) return cached;

        let fetched: IGDBTimeToBeatPlaytime[];
        try {
            fetched =
                await this.igdbPlaytimeSyncService.getTimesToBeat(idsToFetch);
        } catch (error) {
            this.logger.warn(
                `IGDB time-to-beat lookup failed for ${idsToFetch.length} game(s); returning locally cached rows: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return cached;
        }

        const fetchedByGameId = new Map<number, IGDBTimeToBeatPlaytime>();
        for (const row of fetched) fetchedByGameId.set(row.game_id, row);

        // Missing IGDB rows are negative-cached with null seconds so they are not refetched for the TTL.
        const upserts = idsToFetch.map((gameId) => {
            const source = fetchedByGameId.get(gameId);
            return this.repository.create({
                gameId,
                hastilySeconds: source?.hastily ?? null,
                normallySeconds: source?.normally ?? null,
                completelySeconds: source?.completely ?? null,
                submitCount: source?.count ?? 0,
                fetchedAt: now,
            });
        });
        await this.repository.upsert(upserts, ["gameId"]);
        for (const row of upserts) cached.set(row.gameId, row);

        return cached;
    }
}
