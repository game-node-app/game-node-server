import { Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerRequest } from "@nestjs/throttler";
import { Socket } from "socket.io";
import { WsException } from "@nestjs/websockets";

@Injectable()
export class WsThrottlerGuard extends ThrottlerGuard {
    async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
        const { context, limit, ttl, throttler, blockDuration, generateKey } =
            requestProps;

        const client: Socket = context.switchToWs().getClient();
        const ip = client.handshake.address;
        const token = client.handshake.query.token as string | undefined;

        const tracker = token ?? ip;

        const key = generateKey(context, tracker, throttler.name!);
        const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
            await this.storageService.increment(
                key,
                ttl,
                limit,
                blockDuration,
                throttler.name!,
            );

        // Throw an error when the user reached their limit.
        if (isBlocked) {
            throw new WsException("Too many requests.");
        }

        return true;
    }
}
