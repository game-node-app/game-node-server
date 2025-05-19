import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cache } from "@nestjs/cache-manager";

@Injectable()
export class XboxSyncAuthService {
    constructor(
        private readonly configService: ConfigService,
        private readonly cacheManager: Cache,
    ) {}

    public getAuthCredentials(): Promise<{
        XSTSToken: string;
        userHash: string;
    }> {}
}
