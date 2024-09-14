import { Injectable, Logger } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { InjectQueue } from "@nestjs/bullmq";
import {
    IGDB_FETCH_FIELDS,
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import { Queue } from "bullmq";
import { HttpService } from "@nestjs/axios";
import { AxiosRequestConfig } from "axios";
import { ConfigService } from "@nestjs/config";
import { IgdbSyncAuthService } from "./igdb-sync-auth.service";
import { lastValueFrom } from "rxjs";

/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See game-queue.processor.ts for processing logic.
 */
@Injectable()
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);
    // Maximum allowed items per page
    private ITEMS_PER_PAGE = 500;

    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME)
        private readonly igdbSyncQueue: Queue,
        private readonly igdbAuthService: IgdbSyncAuthService,
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) {}

    private itemsToChunks(msg: NonNullable<object[]>) {
        const chunkSize = 10;
        const chunks: object[][] = [];
        let temp_chunk: object[] = [];
        for (let i = 0; i < msg.length; i++) {
            temp_chunk.push(msg[i]);
            if (
                temp_chunk.length !== 0 &&
                temp_chunk.length % chunkSize === 0
            ) {
                chunks.push(temp_chunk);
                temp_chunk = [];
            }
        }
        return chunks;
    }

    private async buildRequestParameters(offset: number) {
        const accessToken = await this.igdbAuthService.getAccessToken();

        const TWITCH_CLIENT_ID =
            this.configService.get<string>("TWITCH_CLIENT_ID");

        const fields = IGDB_FETCH_FIELDS.join(", ");

        const config: AxiosRequestConfig = {
            method: "POST",
            url: "https://api.igdb.com/v4/games",
            headers: {
                "Client-ID": TWITCH_CLIENT_ID,
                Authorization: `Bearer ${accessToken}`,
            },
            data: `fields ${fields}; offset ${offset}; limit ${this.ITEMS_PER_PAGE};`,
        };

        return config;
    }

    private async fetchGamesInInterval(offset: number) {
        const requestConfig = await this.buildRequestParameters(offset);

        return lastValueFrom(this.httpService.request<object[]>(requestConfig));
    }

    /**
     * Starts the actual processing of new IGDB entries. Fetches data and stores
     * on our internal queue ot be processed in a delayed manner.
     */
    public async sync() {
        let hasNextPage = true;
        let currentOffset = 0;

        while (hasNextPage) {
            const fetchResponse =
                await this.fetchGamesInInterval(currentOffset);
            const data = fetchResponse.data;
            hasNextPage =
                data != undefined && data.length > this.ITEMS_PER_PAGE;
            currentOffset += this.ITEMS_PER_PAGE;

            const dataAsChunks = this.itemsToChunks(data);

            for (const items of dataAsChunks) {
                this.igdbSyncQueue
                    .add(IGDB_SYNC_JOB_NAME, items)
                    .then(() => {
                        this.logger.log(
                            `Registered ${items.length} items for processing`,
                        );
                    })
                    .catch((err) => {
                        this.logger.error(err);
                    });
            }
        }
    }
}
