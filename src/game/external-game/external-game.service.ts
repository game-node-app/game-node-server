import {
    PlayerLibrarySnapshot,
    PlayerSyncWrite,
} from "../../sync/player-sync-attempt";
import {
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import {
    DeepPartial,
    FindOptionsRelations,
    In,
    IsNull,
    Not,
    QueryFailedError,
    Repository,
} from "typeorm";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { toMap } from "../../utils/toMap";
import { Game } from "../game-repository/entities/game.entity";
import { storeUrl } from "./external-game.utils";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { UnmappedExternalGameOwner } from "./entity/unmapped-external-game-owner.entity";
import { UnmappedExternalGameDto } from "./dto/find-unmapped-external-games.dto";
import { SubmitExternalGameDto } from "./dto/submit-external-game.dto";
import { FindExternalGamesRequestDto } from "./dto/find-external-games.dto";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

const RESERVED_ID_START = 1_000_000_000_000;

@Injectable()
export class ExternalGameService {
    private readonly relations: FindOptionsRelations<GameExternalGame> = {
        psnExtraMappings: true,
    };

    constructor(
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
        @InjectRepository(UnmappedExternalGame)
        private readonly unmappedExternalGameRepository: Repository<UnmappedExternalGame>,
    ) {}

    public async upsert(entity: DeepPartial<GameExternalGame>) {
        await this.gameExternalGameRepository.upsert(entity, ["id"]);
    }

    private reOrderBySourceIds(
        originalIds: string[],
        unOrderedGames: GameExternalGame[],
    ) {
        const gamesMap = toMap(unOrderedGames, "uid");

        return originalIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as GameExternalGame[];
    }

    public findOneById(id: number) {
        return this.gameExternalGameRepository.findOneBy({
            id,
        });
    }

    public findOneByIdOrFail(id: number) {
        return this.gameExternalGameRepository.findOneOrFail({
            where: { id },
            relations: this.relations,
        });
    }

    async findAllForGameId(gameIds: number[]) {
        return this.gameExternalGameRepository.find({
            where: {
                gameId: In(gameIds),
            },
            relations: this.relations,
        });
    }

    /**
     * Returns a list of GameExternalGame for each sourceId (referred to as uid)
     * @param sourceIds
     * @param category
     */
    @PlayerLibrarySnapshot()
    public async getExternalGamesForSourceIds(
        sourceIds: string[],
        category: EGameExternalGameCategory,
        includeAllMappings = false,
    ) {
        const ids = [...new Set(sourceIds)];
        const externalGames: GameExternalGame[] = [];
        for (let offset = 0; offset < ids.length; offset += 500) {
            externalGames.push(
                ...(await this.gameExternalGameRepository.find({
                    where: {
                        uid: In(ids.slice(offset, offset + 500)),
                        category,
                    },
                    relations: this.relations,
                })),
            );
        }
        if (includeAllMappings) {
            const byUid = Map.groupBy(externalGames, (game) => game.uid);
            return ids.flatMap((id) => byUid.get(id) ?? []);
        }
        return this.reOrderBySourceIds(ids, externalGames);
    }

    public async findAll(
        dto: FindExternalGamesRequestDto,
    ): Promise<TPaginationData<GameExternalGame>> {
        const findOptions = buildBaseFindOptions<GameExternalGame>(dto);

        return this.gameExternalGameRepository.findAndCount({
            ...findOptions,
            order: {
                updatedAt: "DESC",
            },
            relations: {
                ...this.relations,
                game: {
                    cover: true,
                },
            },
        });
    }

    /**
     * Active entries that still have no mapping. The mapping check is made here, at read time,
     * because mappings also arrive from the IGDB sync and bulk fills, which never touch this table.
     */
    private activeUnmappedQuery(category?: EGameExternalGameCategory) {
        const query = this.unmappedExternalGameRepository
            .createQueryBuilder("entry")
            .where("entry.isActive = true")
            .andWhere(
                (qb) =>
                    "NOT EXISTS " +
                    qb
                        .subQuery()
                        .select("1")
                        .from(GameExternalGame, "geg")
                        .where("geg.uid = entry.sourceUid")
                        .andWhere("geg.category = entry.category")
                        .getQuery(),
            );
        if (category !== undefined)
            query.andWhere("entry.category = :category", { category });
        return query;
    }

    /** Active entries without a mapping, the most-owned first. Owner identities are never returned. */
    public async getUnmappedGames({
        category,
        limit = 20,
        offset = 0,
    }: {
        category?: EGameExternalGameCategory;
        limit?: number;
        offset?: number;
    }): Promise<TPaginationData<UnmappedExternalGameDto>> {
        const query = this.activeUnmappedQuery(category)
            .leftJoin(
                UnmappedExternalGameOwner,
                "owner",
                "owner.unmappedExternalGameId = entry.id",
            )
            .select("entry.id", "id")
            .addSelect("entry.sourceUid", "sourceUid")
            .addSelect("entry.category", "category")
            .addSelect("entry.name", "name")
            .addSelect("COUNT(owner.userId)", "ownerCount")
            .groupBy("entry.id")
            .orderBy("ownerCount", "DESC")
            .addOrderBy("entry.id", "ASC")
            .offset(offset)
            .limit(limit);

        const [rows, total] = await Promise.all([
            query.getRawMany<UnmappedExternalGameDto>(),
            this.activeUnmappedQuery(category).getCount(),
        ]);
        return [
            rows.map((row) => ({ ...row, ownerCount: Number(row.ownerCount) })),
            total,
        ];
    }

    /** Marks an active entry inactive without a mapping; registration never reactivates it. */
    public async dismissUnmappedGame(id: number) {
        const { affected } = await this.unmappedExternalGameRepository.update(
            { id, isActive: true },
            { isActive: false },
        );
        if (!affected)
            throw new NotFoundException(
                "This unmapped entry does not exist or is no longer active.",
            );
    }

    /** Source IDs among `sourceUids` whose unmapped entry already has a name. */
    public async findNamedUnmappedUids(
        category: EGameExternalGameCategory,
        sourceUids: string[],
    ) {
        const named = new Set<string>();
        for (let offset = 0; offset < sourceUids.length; offset += 500) {
            const rows = await this.unmappedExternalGameRepository.find({
                select: { sourceUid: true },
                where: {
                    category,
                    sourceUid: In(sourceUids.slice(offset, offset + 500)),
                    name: Not(IsNull()),
                },
            });
            for (const row of rows) named.add(row.sourceUid);
        }
        return named;
    }

    /**
     * Registers every unmapped source ID of one sync or import. A new name replaces the stored one,
     * a missing name keeps it, and `isActive` is never touched so resolved entries stay resolved.
     * `userId` is recorded as an owner once per entry; omit it for registrations not made for a user.
     */
    @PlayerSyncWrite()
    public async registerUnmappedGames(
        category: EGameExternalGameCategory,
        entries: { sourceUid: string; name?: string | null }[],
        userId?: string,
    ) {
        // Later entries win, so a name found for a duplicated source ID is not lost.
        const byUid = new Map<string, string | null>();
        for (const { sourceUid, name } of entries) {
            byUid.set(
                sourceUid,
                name?.trim().slice(0, 255) || byUid.get(sourceUid) || null,
            );
        }
        const rows = [...byUid];
        for (let offset = 0; offset < rows.length; offset += 500) {
            const chunk = rows.slice(offset, offset + 500);
            await this.unmappedExternalGameRepository.query(
                "INSERT INTO `unmapped_external_game` (`sourceUid`, `category`, `name`) VALUES ? " +
                    "ON DUPLICATE KEY UPDATE `name` = COALESCE(VALUES(`name`), `name`)",
                [chunk.map(([uid, name]) => [uid, category, name])],
            );
            if (userId) {
                await this.unmappedExternalGameRepository.query(
                    "INSERT IGNORE INTO `unmapped_external_game_owner` (`unmappedExternalGameId`, `userId`) " +
                        "SELECT `id`, ? FROM `unmapped_external_game` WHERE `category` = ? AND `sourceUid` IN (?)",
                    [userId, category, chunk.map(([uid]) => uid)],
                );
            }
        }
    }

    /**
     * Inserts a GameNode-owned row with an ID from the reserved range (>= 1e12),
     * which IGDB IDs (about 3.2M at most) can never reach.
     * shortcut: no unique (uid, category) constraint for non-IGDB rows, so a race between
     * submit and the bulk fill could create a duplicate mapping; add a generated-column
     * unique index if duplicates show up.
     */
    public async insertReserved(
        values: Omit<DeepPartial<GameExternalGame>, "id">,
    ) {
        for (let attempt = 1; ; attempt++) {
            const { max } = (await this.gameExternalGameRepository
                .createQueryBuilder("geg")
                .select("MAX(geg.id)", "max")
                .getRawOne())!;
            const id = Math.max(RESERVED_ID_START, Number(max ?? 0) + 1);
            try {
                await this.gameExternalGameRepository.insert({ ...values, id });
                return id;
            } catch (error) {
                if (
                    attempt >= 5 ||
                    !(error instanceof QueryFailedError) ||
                    error.driverError?.code !== "ER_DUP_ENTRY"
                )
                    throw error;
            }
        }
    }

    /**
     * Maps an active unmapped entry to a game on behalf of an admin's agent.
     * Never overwrites: an existing mapping to another game refuses the call. One to the same game
     * is a success that only resolves the entry, so a retried or already-mapped call is harmless.
     */
    async mapUnmappedGame(id: number, gameId: number) {
        const entry = await this.unmappedExternalGameRepository.findOneBy({
            id,
            isActive: true,
        });
        if (!entry)
            throw new NotFoundException(
                "This unmapped entry does not exist or is no longer active.",
            );
        const game = await this.gameExternalGameRepository.manager.findOne(
            Game,
            { where: { id: gameId }, select: { id: true, name: true } },
        );
        if (!game) throw new NotFoundException("Game not found.");
        const existing = await this.gameExternalGameRepository.find({
            where: { uid: entry.sourceUid, category: entry.category },
            select: { gameId: true },
        });
        if (existing.length && !existing.some((row) => row.gameId === gameId))
            throw new ConflictException(
                `A mapping to game ${existing[0].gameId} already exists for this source ID and category.`,
            );

        if (!existing.length)
            await this.insertReserved({
                uid: entry.sourceUid,
                category: entry.category,
                gameId,
                url: storeUrl(entry.category, entry.sourceUid) ?? undefined,
                origin: "agent",
            });
        await this.unmappedExternalGameRepository.update(
            { id },
            { isActive: false },
        );
        return game;
    }

    async submit(dto: SubmitExternalGameDto) {
        const existing = await this.gameExternalGameRepository.findBy({
            uid: dto.sourceId,
            category: dto.category,
        });
        if (existing.some((row) => row.origin === "igdb")) {
            throw new ConflictException(
                "An IGDB mapping already exists for this source ID and category.",
            );
        }
        if (existing.length > 0) {
            await this.gameExternalGameRepository.update(
                { id: existing[0].id },
                { gameId: dto.gameId, url: dto.sourceUrl, origin: "curated" },
            );
        } else {
            await this.insertReserved({
                uid: dto.sourceId,
                url: dto.sourceUrl,
                category: dto.category,
                gameId: dto.gameId,
                origin: "curated",
            });
        }

        // Deactivates related unmapped entry
        const possibleUnmappedEntry =
            await this.unmappedExternalGameRepository.findOneBy({
                sourceUid: dto.sourceId,
                category: dto.category,
                isActive: true,
            });

        if (possibleUnmappedEntry) {
            await this.unmappedExternalGameRepository.update(
                {
                    id: possibleUnmappedEntry.id,
                },
                {
                    isActive: false,
                },
            );
        }
    }
}
