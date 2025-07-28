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
import { Reflector } from "@nestjs/core";
import { WsException } from "@nestjs/websockets";
import { Socket } from "socket.io";

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

    constructor(private readonly reflector: Reflector) {}

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

        if (ctxType === "http") {
            const request = context.switchToHttp().getRequest();
            return this.validateToken(request.headers.authorization);
        }

        if (ctxType === "ws") {
            const client: Socket = context.switchToWs().getClient();
            const token: string | undefined =
                client.handshake?.auth?.token || client.handshake?.query?.token;

            if (!token) throw new WsException("Missing auth token");

            const isValid = await this.validateToken(`Bearer ${token}`);
            if (!isValid) throw new WsException("Invalid token");

            return true;
        }

        this.logger.warn(`JwtAuthGuard not configured for context: ${ctxType}`);
        return false;
    }

    private async validateToken(token: string) {
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
