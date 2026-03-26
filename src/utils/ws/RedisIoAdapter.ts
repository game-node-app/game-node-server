import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { ServerOptions } from "node:http";
import { version } from "../../../package.json";
import { getRedisConfig } from "../getRedisConfig";

/**
 * A custom adapter that allows SocketIO to connect to Redis for pub/sub functionality, enabling horizontal scaling of WebSocket servers.
 */
export class RedisIoAdapter extends IoAdapter {
    private adapterConstructor: ReturnType<typeof createAdapter>;

    async connectToRedis(): Promise<void> {
        const redisConfig = getRedisConfig();
        const pubClient = createClient({
            url: redisConfig.url,
            clientInfoTag: this.getClientInfoTag(),
        });

        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);

        this.adapterConstructor = createAdapter(pubClient, subClient);
    }

    createIOServer(port: number, options?: ServerOptions): any {
        const server = super.createIOServer(port, options);
        server.adapter(this.adapterConstructor);
        return server;
    }

    private getClientInfoTag(): string {
        try {
            // Try to get NestJS version from package.json
            return `gamenode_server_v${version}`;
        } catch {
            // Fallback if version cannot be determined
            return "gamenode_server";
        }
    }
}
