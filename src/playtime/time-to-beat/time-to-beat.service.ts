import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { IgdbPlaytimeSyncService } from "../../sync/igdb/playtime/igdb-playtime-sync.service";
import { GameTimeToBeatDto } from "../dto/find-game-playtime.dto";
import { IGDBTimeToBeatPlaytime } from "../../sync/igdb/igdb-sync.constants";
import dayjs from "dayjs";

const toDto = (source: IGDBTimeToBeatPlaytime): GameTimeToBeatDto => ({
    createdAt: dayjs(source.created_at * 1000).toDate(),
    updatedAt: dayjs(source.updated_at * 1000).toDate(),
    completionist: source.completely,
    mainPlusSides: source.normally,
    main: source.hastily,
    gameId: source.game_id,
    submitCount: source.count,
    id: source.id,
});

@Injectable()
export class TimeToBeatService {
    constructor(
        private readonly igdbPlaytimeSyncService: IgdbPlaytimeSyncService,
    ) {}

    public async findOneForGameId(gameId: number): Promise<GameTimeToBeatDto> {
        const playtimes = await this.igdbPlaytimeSyncService.getTimesToBeat([
            gameId,
        ]);
        if (playtimes.length === 0) {
            throw new HttpException(
                "No TTB found for game.",
                HttpStatus.NOT_FOUND,
            );
        }

        return toDto(playtimes[0]);
    }

    public async findAllForGameIds(
        gameIds: number[],
    ): Promise<GameTimeToBeatDto[]> {
        const playtimes =
            await this.igdbPlaytimeSyncService.getTimesToBeat(gameIds);
        return playtimes.map(toDto);
    }
}
