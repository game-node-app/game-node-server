import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import * as JsonWebToken from "jsonwebtoken";
import { JwtHeader } from "jsonwebtoken";
import * as jwksClient from "jwks-rsa";
import * as process from "process";
import { Reflector } from "@nestjs/core";

/**
 * Jwt based auth guard. Checks for valid JWT token which is signed by another service/microservice.
 * Should be used for microservice communication.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    private readonly JWKS_URI = `${process.env.DOMAIN_API}/v1/auth/jwt/jwks.json`;

    constructor(private readonly reflector: Reflector) {}

    /**
     * @param jwtHeader - JWT header, from the decoded token
     * @private
     */
    async getSigningKey(jwtHeader: JwtHeader) {
        const client = jwksClient({
            jwksUri: this.JWKS_URI,
        });
        try {
            const signingKey = await client.getSigningKey(jwtHeader.kid);
            return signingKey.getPublicKey();
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * This same logic should be applied to all services/microservices.
     * @param context
     */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctx = context.switchToHttp();

        const isPublic = this.reflector.get<boolean>(
            "isPublic",
            context.getHandler(),
        );

        if (isPublic) {
            return true;
        }

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
        try {
            const jwtHeader = decodedToken.header;
            const signingKey = await this.getSigningKey(jwtHeader);
            // @ts-ignore
            JsonWebToken.verify(bearerToken, signingKey, {
                algorithms: ["RS256"],
            });
        } catch (e) {
            console.error(e);
            return false;
        }

        return true;
    }
}
