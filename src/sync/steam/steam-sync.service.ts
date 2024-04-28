import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
// @ts-expect-error ESModule import in CommonJS file, breaks if imported directly
import SteamAPI, { UserSummary } from "steamapi";
import { InjectRepository } from "@nestjs/typeorm";
import { SteamUserMap } from "./entity/steam-user-map.entity";
import { Repository } from "typeorm";

@Injectable()
export class SteamSyncService {
    private logger = new Logger(SteamSyncService.name);
    private client: SteamAPI;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(SteamUserMap)
        private readonly steamUserMapRepository: Repository<SteamUserMap>,
    ) {
        const steamKey = this.configService.get("STEAM_API_KEY");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        import("steamapi").then((p) => {
            if (!steamKey) {
                this.logger.warn(
                    `STEAM_API_KEY not provided. Services related to Steam Sync will not work.`,
                );
                return;
            }
            this.client = new p.default(steamKey);
        });
    }

    /**
     * @param userId
     * @param query - id, username, profile url, vanity url, steamID2, or steamID3
     */
    public async resolveUserInfo(
        userId: string,
        query: string,
    ): Promise<UserSummary> {
        let steamUserId: string;
        try {
            const possibleUserMap = await this.steamUserMapRepository.findOneBy(
                {
                    userId,
                },
            );
            if (possibleUserMap != undefined) {
                steamUserId = possibleUserMap.steamUserId;
            } else {
                steamUserId = await this.client.resolve(query);
                await this.steamUserMapRepository.save({
                    userId,
                    steamUserId,
                });
            }
        } catch (err) {
            throw new HttpException(
                "Invalid or non-existent profile URL",
                HttpStatus.BAD_REQUEST,
            );
        }

        return (await this.client.getUserSummary(steamUserId)) as UserSummary;
    }

    public async getAllGames(userId: string) {
        const userMap = await this.steamUserMapRepository.findOneByOrFail({
            userId,
        });
        return this.client.getUserOwnedGames(userMap.steamUserId, {
            includeAppInfo: false,
            includeFreeGames: true,
            language: "english",
        });
    }
}
