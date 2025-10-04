import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { DeepPartial, FindOptionsRelations, In, Repository } from "typeorm";
import { days } from "@nestjs/throttler";
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
    public async getExternalGamesForSourceIds(
        sourceIds: string[],
        category: EGameExternalGameCategory,
    ) {
        const externalGames = await this.gameExternalGameRepository.find({
            where: {
                uid: In(sourceIds),
                category,
            },
            cache: {
                id: `external-games-ids-${category}-${sourceIds}`,
                milliseconds: days(1),
            },
            relations: this.relations,
        });

        return this.reOrderBySourceIds(sourceIds, externalGames);
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

    public async registerUnmappedGame(
        sourceUid: string,
        category: EGameExternalGameCategory,
    ) {
        const existingEntry =
            await this.unmappedExternalGameRepository.findOneBy({
                sourceUid,
                category,
            });

        if (existingEntry) {
            return;
        }

        await this.unmappedExternalGameRepository.insert({
            sourceUid,
            category,
            isActive: true,
        });
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
