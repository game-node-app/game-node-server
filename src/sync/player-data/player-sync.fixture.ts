import { randomUUID } from "node:crypto";
import { EConnectionType } from "../../connection/connections.constants";
import type { PlayerSyncOwner } from "./player-sync-state.service";

export function playerOwner(
    userId: string,
    source: string = EConnectionType.STEAM,
    externalGameId?: number,
): PlayerSyncOwner {
    return {
        connectionId: 1,
        userId,
        source: source as EConnectionType,
        sourceUserId: "account",
        ownerToken: randomUUID(),
        ...(externalGameId == null ? {} : { externalGameId }),
    };
}

export function playerStateFixture() {
    let userId = "user";
    let source = EConnectionType.STEAM;
    return {
        findConnection: jest.fn(
            async (user: string, provider: EConnectionType) => {
                userId = user;
                source = provider;
                return {
                    id: 1,
                    profileUserId: user,
                    sourceUserId: "account",
                    type: provider,
                };
            },
        ),
        initialize: jest.fn().mockResolvedValue({}),
        initializeExisting: jest.fn().mockResolvedValue({}),
        claim: jest.fn(async (_id: number, _account: string, gameId?: number) =>
            playerOwner(userId, source, gameId),
        ),
        enqueue: jest.fn((owner, queue, name, data) =>
            queue.add(
                name,
                { ...data, owner },
                { jobId: `player-sync-${owner.ownerToken}` },
            ),
        ),
        runOwned: jest.fn((_owner, work) => work()),
        write: jest.fn((_owner, work) => work()),
        dueStages: jest.fn().mockResolvedValue(["playtime", "discovery"]),
        failStage: jest.fn().mockResolvedValue(undefined),
        completeStage: jest.fn().mockResolvedValue(undefined),
        completeGame: jest.fn().mockResolvedValue(undefined),
        finish: jest.fn().mockResolvedValue(undefined),
        assertCurrent: jest.fn().mockResolvedValue(undefined),
    };
}
