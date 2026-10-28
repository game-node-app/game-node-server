import {
    PlayerLibrarySnapshot,
    PlayerSyncWrite,
} from "../../sync/player-sync-attempt";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import {
    DeepPartial,
    FindOptionsRelations,
    In,
    QueryFailedError,
    Repository,
} from "typeorm";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";
import { toMap } from "../../utils/toMap";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { SubmitExternalGameDto } from "./dto/submit-external-game.dto";
import { FindExternalGamesRequestDto } from "./dto/find-external-games.dto";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

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

    public async getUnmappedGames() {
        return this.unmappedExternalGameRepository.find({
            where: {
                isActive: true,
            },
        });
    }

    @PlayerSyncWrite()
    public async registerUnmappedGame(
        sourceUid: string,
        category: EGameExternalGameCategory,
    ) {
        try {
            await this.unmappedExternalGameRepository.insert({
                sourceUid,
                category,
                isActive: true,
            });
        } catch (error) {
            if (
                !(error instanceof QueryFailedError) ||
                error.driverError?.code !== "ER_DUP_ENTRY"
            )
                throw error;
        }
    }

    async submit(dto: SubmitExternalGameDto) {
        const existingEntry = await this.gameExternalGameRepository.findOneBy({
            category: dto.category,
            gameId: dto.gameId,
        });

        const randomNumber = Math.floor(Math.random() * 1000000);

        await this.gameExternalGameRepository.save({
            id: existingEntry ? existingEntry.id : randomNumber,
            uid: dto.sourceId,
            url: dto.sourceUrl,
            category: dto.category,
            gameId: dto.gameId,
        });

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
