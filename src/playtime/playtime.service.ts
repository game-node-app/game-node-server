import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { DeepPartial, In, Repository } from "typeorm";
import { toMap } from "../utils/toMap";
import { HltbSyncUpdateService } from "../sync/hltb/hltb-sync-update.service";
import { GameRepositoryService } from "../game/game-repository/game-repository.service";

@Injectable()
export class PlaytimeService {
    private logger = new Logger(PlaytimeService.name);

    constructor(
        @InjectRepository(GamePlaytime)
        private gamePlaytimeRepository: Repository<GamePlaytime>,
        @Inject(forwardRef(() => HltbSyncUpdateService))
        private readonly hltbSyncUpdateService: HltbSyncUpdateService,
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    public async findOneByGameId(gameId: number) {
        return await this.gamePlaytimeRepository.findOneBy({
            gameId,
        });
    }

    public async findOneByGameIdOrFail(gameId: number) {
        const entity = await this.findOneByGameId(gameId);
        if (!entity) {
            throw new HttpException(
                "No playtime info found for game.",
                HttpStatus.BAD_REQUEST,
            );
        }

        return entity;
    }

    /**
     * Triggers a HLTB sync update if no game playtime is found for a given game id.
     * @param gameId
     */
    public async findOneByGameIdAndRequestUpdate(gameId: number) {
        try {
            return await this.findOneByGameIdOrFail(gameId);
        } catch (err: unknown) {
            this.registerUpdateRequest(gameId);
            throw err;
        }
    }

    private registerUpdateRequest(gameId: number) {
        this.gameRepositoryService
            .findOneById(gameId)
            .then((game) => {
                if (game) {
                    this.hltbSyncUpdateService.registerUpdateRequest({
                        gameId: gameId,
                        name: game.name,
                    });
                }
            })
            .catch((err) => {
                this.logger.error(
                    `Failed to register update request for missing playtime for gameId: ${gameId}`,
                );
                this.logger.error(err);
            });
    }

    public async findAllByGameIds(gameIds: number[]) {
        return this.gamePlaytimeRepository.find({
            where: {
                gameId: In(gameIds),
            },
        });
    }

    /**
     * Shorthand method that transforms the result of 'findAllByGameIds'
     * in a map where the 'gameId' is the key.
     * @see PlaytimeService#findAllByGameIds
     * @param gameIds
     */
    public async getPlaytimesMap(gameIds: number[]) {
        const playtimes = await this.findAllByGameIds(gameIds);

        return toMap(playtimes, "gameId");
    }

    public async save(entity: DeepPartial<GamePlaytime>) {
        if (entity.gameId == undefined) {
            this.logger.warn(
                `Ignoring attempt to save entity with undefined gameId: ${JSON.stringify(entity)}`,
            );
            return;
        }
        const playtimeInfo = await this.findOneByGameId(entity.gameId);

        const updatedEntity: DeepPartial<GamePlaytime> = {
            ...playtimeInfo,
            ...entity,
            updatedAt: new Date(),
        };

        await this.gamePlaytimeRepository.save(updatedEntity);
    }
}
