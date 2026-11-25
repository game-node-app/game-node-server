import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { days } from "@nestjs/throttler";
import { DataSource, In, LessThan, Repository } from "typeorm";
import sharp from "sharp";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import {
    addDays,
    DAILY_IMAGE_WIDTHS,
    DAILY_MAX_ATTEMPTS,
    dailyNextResetAt,
    dailyPoints,
    dailyToday,
    DailyMode,
    DailyPuzzleKind,
    DailyStatus,
    practiceRoundsCutoff,
} from "./daily.constants";
import {
    DailyEvaluation,
    DailyGameData,
    DailyNamed,
    assertProgressCanGrow,
    evaluateDaily,
} from "./daily-evaluator";
import {
    DailyImageKind,
    DailyImageTokenPayload,
    signDailyImageToken,
    verifyDailyImageToken,
} from "./daily-image-token";
import {
    DailyArchiveRequestDto,
    DailyImportResultsRequestDto,
    DailyPlayRequestDto,
} from "./dto/daily-request.dto";
import {
    DailyArchiveResponseDto,
    DailyImportResultsResponseDto,
    DailyPlayResponseDto,
    DailyPlayStateDto,
    DailyPuzzleDto,
    DailyRankingSummaryDto,
    DailyResultsResponseDto,
    DailyTodayResponseDto,
} from "./dto/daily-response.dto";
import { Game } from "../game/game-repository/entities/game.entity";
import { GameKeyword } from "../game/game-repository/entities/game-keyword.entity";
import { GameCover } from "../game/game-repository/entities/game-cover.entity";
import { GameArtwork } from "../game/game-repository/entities/game-artwork.entity";
import { buildPaginationResponse } from "../utils/pagination/buildPaginationResponse";
import { DailyRankingService } from "./daily-ranking.service";
import { GuildQueueService } from "../guild/guild-queue/guild-queue.service";

const MODE_ORDER = Object.values(DailyMode);

// IGDB stores protocol-relative URLs with the size in the path (e.g. //images.igdb.com/.../t_thumb/x.jpg).
const igdbImageUrl = (url: string | undefined, size: string) => {
    if (!url) return null;
    const sized = url.replace(/\/t_[a-z0-9_]+\//, `/${size}/`);
    return sized.startsWith("//") ? `https:${sized}` : sized;
};

const named = (
    items: { id: number; name?: string }[] | undefined,
): DailyNamed[] => [
    ...new Map(
        (items ?? []).map((item) => [
            item.id,
            { id: item.id, name: item.name ?? "" },
        ]),
    ).values(),
];

const toGameData = (game: Game): DailyGameData => ({
    id: game.id,
    name: game.name,
    slug: game.slug,
    year: game.firstReleaseDate
        ? new Date(game.firstReleaseDate).getUTCFullYear()
        : null,
    coverUrl: igdbImageUrl(game.cover?.url, "t_cover_big"),
    franchises: named(game.franchises),
    genres: named(game.genres),
    platforms: named(game.platforms),
    themes: named(game.themes),
    gameModes: named(game.gameModes),
    perspectives: named(game.playerPerspectives),
    gameEngines: named(game.gameEngines),
    companies: named(
        game.involvedCompanies
            ?.filter((involved) => involved.developer || involved.publisher)
            .map((involved) => involved.company),
    ),
});

interface DailyContext {
    games: Map<number, DailyGameData>;
    keywords: Map<number, string>;
}

/** What evaluating a play needs: a daily puzzle or a practice round. */
type DailyAnswerSource = Pick<DailyPuzzle, "gameId" | "mode" | "meta">;

type PlayResult = Pick<
    DailyResult,
    "puzzleId" | "status" | "ranked" | "points"
>;
type PlayOutcome = { saved: DailyResult } | { result: PlayResult };

@Injectable()
export class DailyService {
    private readonly imageSecret: string;

    constructor(
        @InjectRepository(DailyPuzzle)
        private readonly puzzleRepository: Repository<DailyPuzzle>,
        @InjectRepository(DailyResult)
        private readonly resultRepository: Repository<DailyResult>,
        private readonly dataSource: DataSource,
        @Inject(CACHE_MANAGER) private readonly cache: Cache,
        configService: ConfigService,
        private readonly rankingService: DailyRankingService,
        @Optional()
        private readonly guildQueueService?: GuildQueueService,
    ) {
        this.imageSecret =
            configService.getOrThrow<string>("DAILY_IMAGE_SECRET");
    }

    async findToday(userId?: string): Promise<DailyTodayResponseDto> {
        const date = dailyToday();
        const puzzles = await this.puzzleRepository.findBy({
            date,
            kind: "daily",
        });
        puzzles.sort(
            (a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode),
        );
        return {
            date,
            nextResetAt: dailyNextResetAt(date),
            weekly: await this.rankingService.weeklyEntry(userId),
            puzzles: await this.toPuzzleDtos(puzzles, userId),
        };
    }

    async findArchive(
        userId: string | undefined,
        dto: DailyArchiveRequestDto,
    ): Promise<DailyArchiveResponseDto> {
        const [puzzles, total] = await this.puzzleRepository.findAndCount({
            where: {
                mode: dto.mode,
                kind: "daily",
                date: LessThan(dailyToday()),
            },
            order: { date: "DESC", id: "ASC" },
            skip: dto.offset,
            take: dto.limit,
        });
        return buildPaginationResponse(
            [await this.toPuzzleDtos(puzzles, userId), total],
            dto,
        );
    }

    async play(
        userId: string | undefined,
        puzzleId: number,
        dto: DailyPlayRequestDto,
    ): Promise<DailyPlayResponseDto> {
        const today = dailyToday();
        const puzzle = await this.puzzleRepository.findOneBy({ id: puzzleId });
        if (!puzzle || puzzle.date > today)
            throw new NotFoundException("Puzzle not found");
        const saved = userId
            ? await this.resultRepository.findOneBy({ userId, puzzleId })
            : null;
        // Finished, or an empty play (opening the puzzle on another device): return the saved progress.
        if (
            saved &&
            (saved.status !== DailyStatus.IN_PROGRESS || !dto.guesses.length)
        )
            return this.toPlayResponse(
                puzzle,
                await this.evaluate(puzzle, saved.guesses, saved.hintAt),
                saved.hintAt,
                await this.rankingSummary(userId, puzzle, saved),
            );

        const { guesses } = dto;
        const hintAt = dto.hintAt ?? null;
        // A saved hint is fixed; a new one can't be placed before the guesses already saved.
        if (saved) assertProgressCanGrow(saved, guesses, hintAt);

        const evaluation = await this.evaluate(puzzle, guesses, hintAt);
        // Opening a puzzle without playing it doesn't create a result.
        if (!userId || (!saved && !guesses.length))
            return this.toPlayResponse(puzzle, evaluation, hintAt);

        // The finishing upsert and the ranking recompute commit together behind the
        // profile row lock, so the recompute always reads this transaction's result.
        const outcome: PlayOutcome = await this.dataSource.transaction(
            async (manager) => {
                await manager.query(
                    "SELECT userId FROM profile WHERE userId = ? FOR UPDATE",
                    [userId],
                );
                const current = await manager
                    .getRepository(DailyResult)
                    .findOneBy({ userId, puzzleId });
                // Another request finished it while this one waited for the lock.
                if (
                    current &&
                    (current.status !== DailyStatus.IN_PROGRESS ||
                        !guesses.length)
                )
                    return { saved: current };
                if (current) assertProgressCanGrow(current, guesses, hintAt);

                const finished = evaluation.status !== DailyStatus.IN_PROGRESS;
                // Counted once, while the puzzle is still active: same day for daily, its week for weekly.
                const activeEnd = addDays(
                    puzzle.date,
                    puzzle.kind === "weekly" ? 6 : 0,
                );
                const ranked =
                    finished && today >= puzzle.date && today <= activeEnd;
                const points =
                    ranked && puzzle.kind === "daily"
                        ? dailyPoints(
                              puzzle.mode,
                              evaluation.status,
                              evaluation.attempts,
                          )
                        : 0;
                await manager.getRepository(DailyResult).upsert(
                    {
                        userId,
                        puzzleId,
                        guesses,
                        hintAt,
                        status: evaluation.status,
                        attempts: evaluation.attempts,
                        ranked,
                        points,
                        finishedAt: finished ? new Date() : null,
                    },
                    ["userId", "puzzleId"],
                );
                if (ranked && puzzle.kind === "daily")
                    await this.rankingService.recompute(userId, today, manager);
                return {
                    result: {
                        puzzleId: puzzle.id,
                        status: evaluation.status,
                        ranked,
                        points,
                    },
                };
            },
        );
        if ("saved" in outcome)
            return this.toPlayResponse(
                puzzle,
                await this.evaluate(
                    puzzle,
                    outcome.saved.guesses,
                    outcome.saved.hintAt,
                ),
                outcome.saved.hintAt,
                await this.rankingSummary(userId, puzzle, outcome.saved),
            );
        if (outcome.result.status === DailyStatus.WON)
            this.guildQueueService?.enqueueEvaluation(userId, "daily");
        return this.toPlayResponse(
            puzzle,
            evaluation,
            hintAt,
            await this.rankingSummary(userId, puzzle, outcome.result),
        );
    }

    async findResults(
        userId: string,
        mode?: DailyMode,
        kind: DailyPuzzleKind = "daily",
    ): Promise<DailyResultsResponseDto> {
        const results = await this.resultRepository.find({
            where: { userId, puzzle: { kind, ...(mode && { mode }) } },
            relations: { puzzle: true },
            order: { puzzle: { date: "DESC" } },
        });
        return {
            data: results.map((result) => ({
                puzzleId: result.puzzleId,
                mode: result.puzzle.mode,
                number: result.puzzle.number,
                date: result.puzzle.date,
                status: result.status,
                attempts: result.attempts,
                finishedAt: result.finishedAt,
            })),
        };
    }

    /** Imports finished guest plays; results the user already has are kept as they are. */
    async importResults(
        userId: string,
        dto: DailyImportResultsRequestDto,
    ): Promise<DailyImportResultsResponseDto> {
        const puzzleIds = dto.results.map((item) => item.puzzleId);
        if (!puzzleIds.length) return { imported: 0 };
        const today = dailyToday();
        const puzzles = new Map(
            (await this.puzzleRepository.findBy({ id: In(puzzleIds) }))
                .filter((puzzle) => puzzle.date <= today)
                .map((puzzle) => [puzzle.id, puzzle]),
        );
        const existing = await this.resultRepository.findBy({
            userId,
            puzzleId: In(puzzleIds),
        });
        const done = new Set(existing.map((result) => result.puzzleId));
        const context = await this.loadContext(
            [...puzzles.values()],
            dto.results.flatMap((item) => item.guesses),
        );

        let imported = 0;
        let importedWin = false;
        for (const item of dto.results) {
            const puzzle = puzzles.get(item.puzzleId);
            if (!puzzle || done.has(puzzle.id)) continue;
            const hintAt = item.hintAt ?? null;
            let evaluation: DailyEvaluation;
            try {
                evaluation = this.evaluateWith(
                    context,
                    puzzle,
                    item.guesses,
                    hintAt,
                );
            } catch (error) {
                if (error instanceof BadRequestException) continue;
                throw error;
            }
            if (evaluation.status === DailyStatus.IN_PROGRESS) continue;
            await this.resultRepository.insert({
                userId,
                puzzleId: puzzle.id,
                guesses: item.guesses,
                hintAt,
                status: evaluation.status,
                attempts: evaluation.attempts,
                ranked: false,
                finishedAt: new Date(),
            });
            done.add(puzzle.id);
            imported++;
            importedWin ||= evaluation.status === DailyStatus.WON;
        }
        if (importedWin)
            this.guildQueueService?.enqueueEvaluation(userId, "daily");
        return { imported };
    }

    async getImage(token: string): Promise<Buffer> {
        const payload = verifyDailyImageToken(token, this.imageSecret);
        if (!payload) throw new ForbiddenException("Invalid image token");
        const key = `daily:image:${payload.s ?? "p"}:${payload.p}:${payload.k}:${payload.l}`;
        const cached = await this.cache.get<string>(key).catch(() => undefined);
        if (cached) return Buffer.from(cached, "base64");

        const answer =
            payload.s === "r"
                ? await this.practiceAnswer(String(payload.p))
                : await this.puzzleRepository.findOneBy({
                      id: Number(payload.p),
                  });
        if (!answer)
            throw new NotFoundException(
                payload.s === "r"
                    ? "Practice round not found"
                    : "Puzzle not found",
            );
        const url = await this.imageUrl(answer, payload.k);
        if (!url) throw new NotFoundException("Image not found");

        let source: Buffer;
        try {
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`IGDB answered ${response.status}`);
            source = Buffer.from(await response.arrayBuffer());
        } catch {
            throw new ServiceUnavailableException("Image is unavailable");
        }
        let image: Buffer;
        if (payload.l === "full") image = await sharp(source).webp().toBuffer();
        else {
            const { width, height } = await sharp(source).metadata();
            // Two pipelines: sharp only applies the last resize of a single one.
            const small = await sharp(source)
                .resize({
                    width: DAILY_IMAGE_WIDTHS[payload.l],
                    kernel: "nearest",
                })
                .toBuffer();
            image = await sharp(small)
                .resize({ width, height, fit: "fill", kernel: "nearest" })
                .webp()
                .toBuffer();
        }
        await this.cache
            .set(key, image.toString("base64"), days(2))
            .catch(() => undefined);
        return image;
    }

    private async imageUrl(
        puzzle: Pick<DailyPuzzle, "gameId" | "meta">,
        kind: DailyImageKind,
    ) {
        if (kind === "cover") {
            const cover = await this.dataSource
                .getRepository(GameCover)
                .findOneBy({ game: { id: puzzle.gameId } });
            return igdbImageUrl(cover?.url, "t_cover_big");
        }
        // An undefined id would match any row.
        if (!puzzle.meta.artworkId) return null;
        const artwork = await this.dataSource
            .getRepository(GameArtwork)
            .findOneBy({ id: puzzle.meta.artworkId });
        return igdbImageUrl(artwork?.url, "t_1080p");
    }

    /** The round's answer, or `null` once the round is past its lifetime. */
    private async practiceAnswer(
        roundId: string,
    ): Promise<DailyAnswerSource | null> {
        const round = await this.dataSource
            .getRepository(DailyPracticeRound)
            .findOneBy({ id: roundId });
        return round && round.createdAt >= practiceRoundsCutoff()
            ? round
            : null;
    }

    private async toPuzzleDtos(
        puzzles: DailyPuzzle[],
        userId?: string,
    ): Promise<DailyPuzzleDto[]> {
        const results =
            userId && puzzles.length
                ? await this.resultRepository.findBy({
                      userId,
                      puzzleId: In(puzzles.map((puzzle) => puzzle.id)),
                  })
                : [];
        const byPuzzle = new Map(
            results.map((result) => [result.puzzleId, result]),
        );
        return puzzles.map((puzzle) => {
            const result = byPuzzle.get(puzzle.id);
            return {
                id: puzzle.id,
                mode: puzzle.mode,
                number: puzzle.number,
                date: puzzle.date,
                maxAttempts: DAILY_MAX_ATTEMPTS[puzzle.mode],
                result: result
                    ? { status: result.status, attempts: result.attempts }
                    : undefined,
            };
        });
    }

    /** Evaluates a saved or incoming play against its answer. */
    async evaluate(
        puzzle: DailyAnswerSource,
        guesses: (number | null)[],
        hintAt: number | null,
    ) {
        return this.evaluateWith(
            await this.loadContext([puzzle], guesses),
            puzzle,
            guesses,
            hintAt,
        );
    }

    /** Loads every game and keyword the evaluations need in one go. */
    private async loadContext(
        puzzles: Pick<DailyPuzzle, "gameId" | "meta">[],
        guessIds: (number | null)[],
    ): Promise<DailyContext> {
        const ids = [
            ...new Set([
                ...puzzles.map((puzzle) => puzzle.gameId),
                ...guessIds.filter((id): id is number => id !== null),
            ]),
        ];
        const keywordIds = puzzles.flatMap(
            (puzzle) => puzzle.meta.keywordIds ?? [],
        );
        const games = ids.length
            ? await this.dataSource.getRepository(Game).find({
                  where: { id: In(ids) },
                  relations: {
                      cover: true,
                      franchises: true,
                      genres: true,
                      platforms: true,
                      themes: true,
                      gameModes: true,
                      playerPerspectives: true,
                      gameEngines: true,
                      involvedCompanies: { company: true },
                  },
                  relationLoadStrategy: "query",
              })
            : [];
        const keywords = keywordIds.length
            ? await this.dataSource
                  .getRepository(GameKeyword)
                  .findBy({ id: In(keywordIds) })
            : [];
        return {
            games: new Map(games.map((game) => [game.id, toGameData(game)])),
            keywords: new Map(
                keywords.map((keyword) => [keyword.id, keyword.name ?? ""]),
            ),
        };
    }

    private evaluateWith(
        context: DailyContext,
        puzzle: DailyAnswerSource,
        guesses: (number | null)[],
        hintAt: number | null,
    ): DailyEvaluation {
        const answer = context.games.get(puzzle.gameId);
        if (!answer) throw new NotFoundException("Puzzle game not found");
        return evaluateDaily({
            mode: puzzle.mode,
            answer,
            guesses: guesses.map((id) => {
                if (id === null) return null;
                const game = context.games.get(id);
                if (!game) throw new BadRequestException(`Unknown game ${id}`);
                return game;
            }),
            hintAt,
            keywords: (puzzle.meta.keywordIds ?? [])
                .map((id) => context.keywords.get(id))
                .filter((name): name is string => !!name),
        });
    }

    /** The ranking block belongs to signed-in, finished daily puzzles only. */
    private rankingSummary(
        userId: string | undefined,
        puzzle: DailyPuzzle,
        result: Pick<DailyResult, "puzzleId" | "status" | "ranked" | "points">,
    ): Promise<DailyRankingSummaryDto | undefined> {
        if (
            !userId ||
            puzzle.kind !== "daily" ||
            result.status === DailyStatus.IN_PROGRESS
        )
            return Promise.resolve(undefined);
        return this.rankingService.summaryAfterPlay(
            userId,
            result,
            puzzle.date,
        );
    }

    /** The play state a daily puzzle and a practice round share, with image tokens for `source`. */
    buildPlayState(
        answer: DailyAnswerSource,
        evaluation: DailyEvaluation,
        hintAt: number | null,
        source: Pick<DailyImageTokenPayload, "p" | "s">,
    ): DailyPlayStateDto {
        const { imageLevel, ...hints } = evaluation.hints;
        const levels: (number | "full")[] =
            imageLevel === null
                ? []
                : Array.from({ length: imageLevel + 1 }, (_, level) => level);
        if (
            evaluation.status !== DailyStatus.IN_PROGRESS &&
            answer.mode !== DailyMode.SPECS
        )
            levels.push("full");
        const kind = answer.mode === DailyMode.ARTWORK ? "artwork" : "cover";
        return {
            mode: answer.mode,
            maxAttempts: DAILY_MAX_ATTEMPTS[answer.mode],
            attempts: evaluation.attempts,
            status: evaluation.status,
            feedback: evaluation.feedback,
            hints: {
                ...hints,
                imageTokens: levels.map((l) =>
                    signDailyImageToken(
                        { ...source, k: kind, l },
                        this.imageSecret,
                    ),
                ),
            },
            hintAvailable: evaluation.hintAvailable,
            hintAt,
            answer: evaluation.answer,
        };
    }

    private async toPlayResponse(
        puzzle: DailyPuzzle,
        evaluation: DailyEvaluation,
        hintAt: number | null,
        ranking?: DailyRankingSummaryDto,
    ): Promise<DailyPlayResponseDto> {
        const finished = evaluation.status !== DailyStatus.IN_PROGRESS;
        return {
            puzzleId: puzzle.id,
            number: puzzle.number,
            date: puzzle.date,
            ...this.buildPlayState(puzzle, evaluation, hintAt, {
                p: puzzle.id,
            }),
            community: finished ? await this.community(puzzle.id) : undefined,
            ...(ranking && { ranking }),
        };
    }

    private async community(puzzleId: number) {
        const [row] = await this.dataSource.query(
            "SELECT COUNT(*) AS players, AVG(attempts) AS averageAttempts FROM daily_result WHERE puzzleId = ? AND status = ?",
            [puzzleId, DailyStatus.WON],
        );
        return {
            players: Number(row.players),
            averageAttempts: Number(row.averageAttempts ?? 0),
        };
    }
}
