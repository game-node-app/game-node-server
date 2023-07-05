import { FindIgdbDto } from "./dto/find-igdb.dto";
import { IgdbAuthService } from "./igdb.auth.service";
import { GameMetadata } from "../utils/game-metadata.dto";
import { FindIgdbIdDto } from "./dto/find-igdb-id.dto";
import { Cache } from "cache-manager";
export declare class IgdbService {
    private igdbAuthService;
    private cacheManager;
    private CACHE_TIME_SECONDS;
    private igdbClient;
    private readonly igdbFields;
    private logger;
    constructor(igdbAuthService: IgdbAuthService, cacheManager: Cache);
    buildIgdbClient(): Promise<void>;
    getFromStore(key: string): Promise<GameMetadata[] | undefined>;
    setToStore(key: string, results: GameMetadata[]): Promise<void>;
    buildStoreKey(dto: object): string;
    findByIds(queryIdDto: FindIgdbIdDto): Promise<GameMetadata[]>;
    findByIdsOrFail(queryIdDto: FindIgdbIdDto): Promise<GameMetadata[]>;
    find(queryDto: FindIgdbDto): Promise<GameMetadata[]>;
}
