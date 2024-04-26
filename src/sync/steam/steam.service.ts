import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import SteamAPI from "steamapi";

@Injectable()
export class SteamService {
    private client: SteamAPI;

    constructor(configService: ConfigService) {
        this.client = new SteamAPI(configService.getOrThrow("STEAM_API_KEY"));
    }

    /**
     * @param query - id, username, profile url, vanity url, steamID2, or steamID3
     */
    public async resolveUserId(query: string) {
        return this.client.resolve(query);
    }

    public async getAllGames(steamUserId: string) {
        return this.client.getUserOwnedGames(steamUserId, {
            includeAppInfo: true,
            includeFreeGames: true,
            language: "english",
        });
    }

    public async getAllUnprocessedGames(steamUserId: string) {}
}
