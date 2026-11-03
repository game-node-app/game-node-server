import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { DailyMode } from "./daily.constants";
import { DailyPuzzleMeta } from "./entity/daily-puzzle.entity";
import { EGameCategory } from "../game/game-repository/game-repository.constants";
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";
import { getRandomItems } from "../utils/getRandomItems";

const MODE_FILTERS: Record<DailyMode, string> = {
    [DailyMode.COVER]:
        "EXISTS (SELECT 1 FROM game_cover c WHERE c.gameId = g.id AND c.url IS NOT NULL)",
    [DailyMode.ARTWORK]:
        "EXISTS (SELECT 1 FROM game_artwork a WHERE a.gameId = g.id AND a.url IS NOT NULL)",
    [DailyMode.KEYWORDS]: `(SELECT COUNT(*) FROM game_keywords_game_keyword gk JOIN game_keyword k ON k.id = gk.gameKeywordId
        WHERE gk.gameId = g.id AND k.name IS NOT NULL) >= 8`,
    // A release year is needed for the year column and range hint.
    [DailyMode.SPECS]: `EXISTS (SELECT 1 FROM game_genres_game_genre x WHERE x.gameId = g.id)
        AND EXISTS (SELECT 1 FROM game_platform_games_game x WHERE x.gameId = g.id)
        AND EXISTS (SELECT 1 FROM game_involved_companies_game_involved_company x
            JOIN game_involved_company ic ON ic.id = x.gameInvolvedCompanyId
            WHERE x.gameId = g.id AND (ic.developer = 1 OR ic.publisher = 1))
        AND g.firstReleaseDate <= NOW()`,
};

/** Candidate sources, tried in order: popularity first, IGDB rating count when there is no popularity yet. */
const CANDIDATE_SOURCES = [
    "SELECT g.id FROM ranking_score rs JOIN game g ON g.statisticsTargetId = rs.targetId WHERE rs.rankingKey = 'game:popular:all' AND rs.score > 0 ORDER BY rs.score DESC LIMIT 1000",
    `SELECT id FROM game WHERE category = ${EGameCategory.Main} ORDER BY aggregatedRatingCount DESC LIMIT 1000`,
];

@Injectable()
export class DailyPoolService {
    constructor(private readonly dataSource: DataSource) {}

    /** Picks a random eligible game for `mode` on `date`, or `null` when none is left. */
    async pick(
        mode: DailyMode,
        date: string,
    ): Promise<{ gameId: number; meta: DailyPuzzleMeta } | null> {
        for (const source of CANDIDATE_SOURCES) {
            const [row] = await this.dataSource.query(
                `SELECT g.id FROM (${source}) candidate JOIN game g ON g.id = candidate.id
                WHERE g.category = ${EGameCategory.Main} AND ${MODE_FILTERS[mode]}
                    AND NOT EXISTS (SELECT 1 FROM game_themes_game_theme m WHERE m.gameId = g.id AND m.gameThemeId = ${MATURE_THEME_ID})
                    AND g.id NOT IN (SELECT p.gameId FROM daily_puzzle p WHERE p.mode = ? AND p.date > DATE_SUB(?, INTERVAL 365 DAY))
                ORDER BY RAND() LIMIT 1`,
                [mode, date],
            );
            if (row) {
                const gameId = Number(row.id);
                return { gameId, meta: await this.meta(mode, gameId) };
            }
        }
        return null;
    }

    private async meta(
        mode: DailyMode,
        gameId: number,
    ): Promise<DailyPuzzleMeta> {
        if (mode === DailyMode.ARTWORK) {
            const [artwork] = await this.dataSource.query(
                "SELECT id FROM game_artwork WHERE gameId = ? AND url IS NOT NULL ORDER BY RAND() LIMIT 1",
                [gameId],
            );
            return { artworkId: Number(artwork.id) };
        }
        if (mode === DailyMode.KEYWORDS) {
            const rows: { id: number }[] = await this.dataSource.query(
                "SELECT k.id FROM game_keywords_game_keyword gk JOIN game_keyword k ON k.id = gk.gameKeywordId WHERE gk.gameId = ? AND k.name IS NOT NULL",
                [gameId],
            );
            const ids = rows.map((row) => Number(row.id));
            return { keywordIds: getRandomItems(ids, ids.length) };
        }
        return {};
    }
}
