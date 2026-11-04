import {
    BadRequestException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
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
import {
    DAILY_IMAGE_WIDTHS,
    DAILY_MAX_ATTEMPTS,
    dailyNextResetAt,
    dailyToday,
    DailyMode,
    DailyStatus,
} from "./daily.constants";
import {
    DailyEvaluation,
    DailyGameData,
    DailyNamed,
    evaluateDaily,
} from "./daily-evaluator";
import {
    DailyImageKind,
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
    DailyPuzzleDto,
    DailyResultsResponseDto,
    DailyTodayResponseDto,
} from "./dto/daily-response.dto";
import { Game } from "../game/game-repository/entities/game.entity";
import { GameKeyword } from "../game/game-repository/entities/game-keyword.entity";
import { GameCover } from "../game/game-repository/entities/game-cover.entity";
import { GameArtwork } from "../game/game-repository/entities/game-artwork.entity";
import { buildPaginationResponse } from "../utils/pagination/buildPaginationResponse";

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
    ) {
        this.imageSecret =
            configService.getOrThrow<string>("DAILY_IMAGE_SECRET");
    }

    async findToday(userId?: string): Promise<DailyTodayResponseDto> {
        const date = dailyToday();
        const puzzles = await this.puzzleRepository.findBy({ date });
        puzzles.sort(
            (a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode),
        );
        return {
            date,
            nextResetAt: dailyNextResetAt(date),
            puzzles: await this.toPuzzleDtos(puzzles, userId),
        };
    }

    async findArchive(
        userId: string | undefined,
        dto: DailyArchiveRequestDto,
    ): Promise<DailyArchiveResponseDto> {
        const [puzzles, total] = await this.puzzleRepository.findAndCount({
            where: { mode: dto.mode, date: LessThan(dailyToday()) },
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
        const puzzle = await this.puzzleRepository.findOneBy({ id: puzzleId });
        if (!puzzle || puzzle.date > dailyToday())
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
            );

        const { guesses } = dto;
        const hintAt = dto.hintAt ?? null;
        // A saved hint is fixed; a new one can't be placed before the guesses already saved.
        if (
            saved &&
            (guesses.length < saved.guesses.length ||
                saved.guesses.some((id, i) => guesses[i] !== id) ||
                (saved.hintAt !== null
                    ? hintAt !== saved.hintAt
                    : hintAt !== null && hintAt < saved.guesses.length))
        )
            throw new BadRequestException(
                "Guesses can only be added to the saved progress",
            );

        const evaluation = await this.evaluate(puzzle, guesses, hintAt);
        // Opening a puzzle without playing it doesn't create a result.
        if (userId && (saved || guesses.length))
            await this.resultRepository.upsert(
                {
                    userId,
                    puzzleId,
                    guesses,
                    hintAt,
                    status: evaluation.status,
                    attempts: evaluation.attempts,
                    finishedAt:
                        evaluation.status === DailyStatus.IN_PROGRESS
                            ? null
                            : new Date(),
                },
                ["userId", "puzzleId"],
            );
        return this.toPlayResponse(puzzle, evaluation, hintAt);
    }

    async findResults(
        userId: string,
        mode?: DailyMode,
    ): Promise<DailyResultsResponseDto> {
        const results = await this.resultRepository.find({
            where: { userId, ...(mode && { puzzle: { mode } }) },
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
                finishedAt: new Date(),
            });
            done.add(puzzle.id);
            imported++;
        }
        return { imported };
    }

    async getImage(token: string): Promise<Buffer> {
        const payload = verifyDailyImageToken(token, this.imageSecret);
        if (!payload) throw new ForbiddenException("Invalid image token");
        const key = `daily:image:${payload.p}:${payload.k}:${payload.l}`;
        const cached = await this.cache.get<string>(key).catch(() => undefined);
        if (cached) return Buffer.from(cached, "base64");

        const puzzle = await this.puzzleRepository.findOneBy({ id: payload.p });
        if (!puzzle) throw new NotFoundException("Puzzle not found");
        const url = await this.imageUrl(puzzle, payload.k);
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

    private async imageUrl(puzzle: DailyPuzzle, kind: DailyImageKind) {
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

    private async evaluate(
        puzzle: DailyPuzzle,
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
        puzzles: DailyPuzzle[],
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
        puzzle: DailyPuzzle,
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

    private async toPlayResponse(
        puzzle: DailyPuzzle,
        evaluation: DailyEvaluation,
        hintAt: number | null,
    ): Promise<DailyPlayResponseDto> {
        const finished = evaluation.status !== DailyStatus.IN_PROGRESS;
        const { imageLevel, ...hints } = evaluation.hints;
        const levels: (number | "full")[] =
            imageLevel === null
                ? []
                : Array.from({ length: imageLevel + 1 }, (_, level) => level);
        if (finished && puzzle.mode !== DailyMode.SPECS) levels.push("full");
        const kind = puzzle.mode === DailyMode.ARTWORK ? "artwork" : "cover";
        return {
            puzzleId: puzzle.id,
            mode: puzzle.mode,
            number: puzzle.number,
            date: puzzle.date,
            maxAttempts: DAILY_MAX_ATTEMPTS[puzzle.mode],
            attempts: evaluation.attempts,
            status: evaluation.status,
            feedback: evaluation.feedback,
            hints: {
                ...hints,
                imageTokens: levels.map((l) =>
                    signDailyImageToken(
                        { p: puzzle.id, k: kind, l },
                        this.imageSecret,
                    ),
                ),
            },
            hintAvailable: evaluation.hintAvailable,
            hintAt,
            answer: evaluation.answer,
            community: finished ? await this.community(puzzle.id) : undefined,
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
