import { Injectable } from "@nestjs/common";
import { Cache } from "@nestjs/cache-manager";
import jwt from "supertokens-node/recipe/jwt";

@Injectable()
export class JwtAuthService {
    private readonly JWT_CACHE_KEY = "jwt-token";

    constructor(private readonly cacheManager: Cache) {}

    private async getKeyFromCache(): Promise<string | null> {
        return this.cacheManager.get(this.JWT_CACHE_KEY);
    }

    private async createJWT() {
        const jwtResponse = await jwt.createJWT({
            // Mandatory
            source: "microservice",
        });
        if (jwtResponse.status === "OK") {
            return jwtResponse.jwt;
        }

        throw new Error("Unable to create JWT. Should never come here.");
    }

    public async getJwtToken(): Promise<string> {
        const possibleJwtToken = await this.getKeyFromCache();
        if (possibleJwtToken) {
            return possibleJwtToken;
        }

        return await this.createJWT();
    }
}
