import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PLAYER_PROVIDER_BUDGET_QUEUE } from "../sync/player-provider-budget.service";
import * as crypto from "node:crypto";
import { EConnectionType } from "./connections.constants";

export interface ConnectionAuthState {
    userId: string;
    type: EConnectionType;
    isAutoImportEnabled?: boolean;
    autoImportCollectionId?: string | null;
    codeVerifier?: string;
    createdAt?: number;
    metadata?: Record<string, any>;
}

@Injectable()
export class ConnectionAuthStateService {
    public static readonly TTL_MS = 10 * 60 * 1000; // 10 minutes

    constructor(
        @InjectQueue(PLAYER_PROVIDER_BUDGET_QUEUE)
        private readonly queue: Queue,
    ) {}

    private getStateKey(state: string): string {
        return `conn-auth-state:${state}`;
    }

    async initState(
        params: Omit<ConnectionAuthState, "createdAt">,
        existingState?: string,
    ): Promise<string> {
        const state =
            existingState && existingState.trim().length > 0
                ? existingState.trim()
                : crypto.randomBytes(32).toString("hex");
        const key = this.getStateKey(state);
        const stateData: ConnectionAuthState = {
            userId: params.userId,
            type: params.type,
            isAutoImportEnabled: params.isAutoImportEnabled,
            autoImportCollectionId: params.autoImportCollectionId,
            codeVerifier: params.codeVerifier,
            metadata: params.metadata,
            createdAt: Date.now(),
        };
        const redis = await this.queue.client;
        await redis.set(
            key,
            JSON.stringify(stateData),
            "PX",
            ConnectionAuthStateService.TTL_MS,
        );
        return state;
    }

    async consumeState(
        state: string,
        expectedUserId: string,
        expectedType: EConnectionType,
    ): Promise<ConnectionAuthState> {
        if (!state || typeof state !== "string" || state.trim().length === 0) {
            throw new HttpException(
                "Invalid, expired, or previously consumed state token",
                HttpStatus.BAD_REQUEST,
            );
        }

        const key = this.getStateKey(state.trim());
        const redis = await this.queue.client;
        const raw = await redis.eval(
            "local value = redis.call('GET', KEYS[1]); redis.call('DEL', KEYS[1]); return value",
            1,
            key,
        );
        if (!raw) {
            throw new HttpException(
                "Invalid, expired, or previously consumed state token",
                HttpStatus.BAD_REQUEST,
            );
        }

        const stored: ConnectionAuthState = JSON.parse(String(raw));
        if (stored.userId !== expectedUserId || stored.type !== expectedType) {
            throw new HttpException(
                "Session or connection type mismatch for authentication state",
                HttpStatus.FORBIDDEN,
            );
        }

        return stored;
    }
}
