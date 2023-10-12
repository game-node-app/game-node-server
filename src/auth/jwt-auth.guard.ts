import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import * as JsonWebToken from "jsonwebtoken";
import { JwtHeader } from "jsonwebtoken";
import * as jwksClient from "jwks-rsa";
import * as process from "process";

/**
 * Jwt based auth guard. Checks for valid JWT token which is signed by another service/microservice.
 * Should be used for microservice communication.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor() {}

    /**
     * @param jwtHeader - JWT header, from the decoded token
     * @param callback
     * @private
     */
    async getSigningKey(jwtHeader: JwtHeader) {
        const apiDomain = process.env.DOMAIN_API;
        const apiDomainBase = process.env.DOMAIN_API_BASE;
        const client = jwksClient({
            jwksUri: `{${apiDomain}${apiDomainBase}/jwt/jwks.json`,
        });
        const signingKey = await client.getSigningKey(jwtHeader.kid);
        return signingKey.getPublicKey();
    }

    /**
     * This same logic should be applied to all services/microservices.
     * @param context
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctx = context.switchToHttp();
        const headers = ctx.getRequest().headers;
        const authorization = headers.authorization as string;
        const bearerToken = authorization?.split("Bearer ")[1];
        if (!authorization || !bearerToken) {
            return false;
        }

        const decodedToken = JsonWebToken.decode(bearerToken, {
            complete: true,
        });
        if (!decodedToken) {
            return false;
        }
        const jwtHeader = decodedToken.header;
        const signingKey = await this.getSigningKey(jwtHeader);

        try {
            JsonWebToken.verify(bearerToken, signingKey, {
                algorithms: ["RS256"],
            });
        } catch (e) {
            return false;
        }

        return true;
    }
}
