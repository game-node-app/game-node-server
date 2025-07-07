import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { lastValueFrom } from "rxjs";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { IGDBTimeToBeatPlaytime } from "../igdb-sync.constants";
import { Cacheable } from "../../../utils/cacheable";
import { Cache } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

@Injectable()
export class IgdbPlaytimeSyncService {
    private readonly logger = new Logger(IgdbPlaytimeSyncService.name);
    private readonly IGDB_API_ENDPOINT =
        "https://api.igdb.com/v4/game_time_to_beats";

    constructor(
        private readonly httpClient: HttpService,
        private readonly authService: IgdbAuthService,
        private readonly cacheManager: Cache,
    ) {}

    @Cacheable(IgdbPlaytimeSyncService.name, minutes(30))
    public async getTimesToBeat(
        gameIds: number[],
    ): Promise<IGDBTimeToBeatPlaytime[]> {
        const headers = await this.authService.getAuthHeaders();
        const gameIdsString = gameIds.join(",");

        const request = this.httpClient.post(
            this.IGDB_API_ENDPOINT,
            `fields *; where game_id = (${gameIdsString});`,
            {
                headers: headers,
            },
        );

        const response = await lastValueFrom(request);
        return response.data;
    }
}
