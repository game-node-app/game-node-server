import { HttpService } from "@nestjs/axios";
import { Cache } from "cache-manager";
export declare const tokenRefreshIntervalSeconds = 604800;
export declare class IgdbAuthService {
    private readonly httpService;
    private cacheManager;
    private logger;
    private cacheKey;
    constructor(httpService: HttpService, cacheManager: Cache);
    private getFromStore;
    private setToStore;
    private fetchToken;
    refreshToken(): Promise<string>;
}
