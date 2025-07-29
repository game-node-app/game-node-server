import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
} from "@nestjs/common";
import * as JsonWebToken from "jsonwebtoken";
import { JwtHeader } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import * as process from "process";
import { Request } from "express";

/**
 * Jwt based auth guard. Can be used for microservice-microservice communication, or for websockets.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    private logger = new Logger(JwtAuthGuard.name);
    private readonly JWKS_URI = `${process.env.DOMAIN_API}/v1/auth/jwt/jwks.json`;
    private readonly jwksClient = jwksClient({
        jwksUri: this.JWKS_URI,
    });

    /**
     * @param jwtHeader - JWT header, from the decoded token
     * @private
     */
    async getSigningKey(jwtHeader: JwtHeader) {
        try {
            const signingKey = await this.jwksClient.getSigningKey(
                jwtHeader.kid,
            );
            return signingKey.getPublicKey();
        } catch (e) {
            console.error(e);
        }
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType<"http" | "ws" | "rpc">();

        if (ctxType !== "http") {
            throw new Error(
                `JwtAuthGuard not configured for context: ${ctxType}`,
            );
        }

        const request: Request = context.switchToHttp().getRequest();

        return this.validateToken(request.headers.authorization);
    }

    private async validateToken(token: string | undefined) {
        const bearerToken = token?.split("Bearer ")[1];

        if (!token || !bearerToken) {
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
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            JsonWebToken.verify(bearerToken, signingKey, {
                algorithms: ["RS256"],
            });
        } catch (e) {
            this.logger.error(e);
            return false;
        }

        return true;
    }
}
