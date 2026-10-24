import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { IGDB_OUTBOUND_BUDGET_QUEUE_NAME } from "./igdb-catalog.constants";

const ADMIT = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= 4 or redis.call('ZCARD', KEYS[2]) >= 8 then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('ZADD', KEYS[2], now + 90000, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 2000)
redis.call('PEXPIRE', KEYS[2], 91000)
return 1`;

@Injectable()
export class IgdbOutboundBudgetService {
    private namespaceValue?: string;
    constructor(
        @InjectQueue(IGDB_OUTBOUND_BUDGET_QUEUE_NAME)
        private readonly queue: Queue,
        private readonly config: ConfigService,
    ) {}

    get namespace(): string {
        if (!this.namespaceValue) {
            const fingerprint = createHash("sha256")
                .update(
                    `${this.config.getOrThrow<string>("TWITCH_CLIENT_ID")}:${this.config.getOrThrow<string>("TWITCH_CLIENT_SECRET")}`,
                )
                .digest("hex");
            this.namespaceValue = `${this.queue.opts.prefix ?? "bull"}:igdb-outbound:{${fingerprint}}`;
        }
        return this.namespaceValue;
    }

    async tryAcquire(): Promise<string | null> {
        const permit = randomUUID();
        const redis = await this.queue.client;
        const admitted = await redis.eval(
            ADMIT,
            2,
            `${this.namespace}:starts`,
            `${this.namespace}:permits`,
            permit,
        );
        return admitted === 1 ? permit : null;
    }

    async release(permit: string) {
        await (
            await this.queue.client
        ).zrem(`${this.namespace}:permits`, permit);
    }

    async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        let permit: string | null = null;
        while (!permit) {
            signal?.throwIfAborted();
            permit = await this.tryAcquire();
            if (!permit)
                await new Promise<void>((resolve, reject) => {
                    const abort = () => {
                        clearTimeout(timer);
                        reject(
                            signal?.reason ??
                                new Error("IGDB request cancelled"),
                        );
                    };
                    const timer = setTimeout(() => {
                        signal?.removeEventListener("abort", abort);
                        resolve();
                    }, 50);
                    signal?.addEventListener("abort", abort, { once: true });
                    if (signal?.aborted) abort();
                });
        }
        try {
            signal?.throwIfAborted();
            return await work();
        } finally {
            await this.release(permit);
        }
    }
}
