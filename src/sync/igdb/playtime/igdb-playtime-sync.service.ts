import { IgdbOutboundBudgetService } from "../catalog/igdb-outbound-budget.service";
import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { lastValueFrom } from "rxjs";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { IGDBTimeToBeatPlaytime } from "../igdb.types";
import { Cacheable } from "../../../utils/cacheable";
import { Cache } from "@nestjs/cache-manager";
import { minutes } from "@nestjs/throttler";

/** IGDB caps `/v4/game_time_to_beats` at 500 rows per request (its default is only 10). */
const TTB_MAX_IDS_PER_REQUEST = 500;

@Injectable()
export class IgdbPlaytimeSyncService {
    private readonly logger = new Logger(IgdbPlaytimeSyncService.name);
    private readonly IGDB_API_ENDPOINT =
        "https://api.igdb.com/v4/game_time_to_beats";

    constructor(
        private readonly httpClient: HttpService,
        private readonly authService: IgdbAuthService,
        private readonly cacheManager: Cache,
        private readonly budget: IgdbOutboundBudgetService,
    ) {}

    @Cacheable(IgdbPlaytimeSyncService.name, minutes(30))
    public async getTimesToBeat(
        gameIds: number[],
    ): Promise<IGDBTimeToBeatPlaytime[]> {
        const ids = [...new Set(gameIds)];
        if (ids.length === 0) return [];

        const headers = await this.authService.getAuthHeaders();
        const rows: IGDBTimeToBeatPlaytime[] = [];

        for (
            let offset = 0;
            offset < ids.length;
            offset += TTB_MAX_IDS_PER_REQUEST
        ) {
            const chunk = ids.slice(offset, offset + TTB_MAX_IDS_PER_REQUEST);
            const response = await this.budget.run(async () => {
                const request = this.httpClient.post(
                    this.IGDB_API_ENDPOINT,
                    // Without an explicit limit IGDB returns only 10 rows, which would
                    // make the caller negative-cache the rest of the batch.
                    `fields *; where game_id = (${chunk.join(",")}); limit ${chunk.length};`,
                    {
                        headers: headers,
                        timeout: 30000,
                        signal: AbortSignal.timeout(30000),
                    },
                );

                return lastValueFrom(request);
            });
            rows.push(...response.data);
        }

        return rows;
    }
}
