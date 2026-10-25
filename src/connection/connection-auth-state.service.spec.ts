import { Queue } from "bullmq";
import { ConnectionAuthStateService } from "./connection-auth-state.service";
import { EConnectionType } from "./connections.constants";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("ConnectionAuthStateService", () => {
    let redis: { set: jest.Mock; eval: jest.Mock };
    let values: Map<string, string>;
    let service: ConnectionAuthStateService;

    beforeEach(() => {
        values = new Map();
        redis = {
            set: jest.fn(async (key, value) => {
                values.set(key, value);
            }),
            eval: jest.fn(async (_script, _keys, key) => {
                const value = values.get(key);
                values.delete(key);
                return value ?? null;
            }),
        };
        service = new ConnectionAuthStateService({
            client: Promise.resolve(redis),
        } as unknown as Queue);
    });

    it("should initialize state with a 10-minute TTL and store payload", async () => {
        const state = await service.initState({
            userId: "user-123",
            type: EConnectionType.STEAM,
            isAutoImportEnabled: true,
            autoImportCollectionId: "col-abc",
            codeVerifier: "verifier-xyz",
        });

        expect(typeof state).toBe("string");
        expect(state).toHaveLength(64); // 32 bytes hex
        expect(redis.set).toHaveBeenCalledTimes(1);

        const [key, value, unit, ttl] = redis.set.mock.calls[0];
        expect(key).toBe(`conn-auth-state:${state}`);
        expect(unit).toBe("PX");
        expect(ttl).toBe(10 * 60 * 1000); // 10 minutes (600000 ms)
        expect(JSON.parse(value)).toMatchObject({
            userId: "user-123",
            type: EConnectionType.STEAM,
            isAutoImportEnabled: true,
            autoImportCollectionId: "col-abc",
            codeVerifier: "verifier-xyz",
        });
        expect(typeof JSON.parse(value).createdAt).toBe("number");
    });

    it("should successfully consume state and delete it from cache", async () => {
        const storedState = {
            userId: "user-123",
            type: EConnectionType.STEAM,
            isAutoImportEnabled: true,
            autoImportCollectionId: "col-abc",
        };
        values.set("conn-auth-state:dummy-state", JSON.stringify(storedState));

        const result = await service.consumeState(
            "dummy-state",
            "user-123",
            EConnectionType.STEAM,
        );

        expect(result).toEqual(storedState);
        expect(values.has("conn-auth-state:dummy-state")).toBe(false);
    });

    it("allows only one concurrent consumption across service instances", async () => {
        const state = await service.initState({
            userId: "user",
            type: EConnectionType.STEAM,
        });
        const other = new ConnectionAuthStateService({
            client: Promise.resolve(redis),
        } as unknown as Queue);
        const results = await Promise.allSettled([
            service.consumeState(state, "user", EConnectionType.STEAM),
            other.consumeState(state, "user", EConnectionType.STEAM),
        ]);
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
    });

    it("should reject with 400 on missing or empty state parameter", async () => {
        await expect(
            service.consumeState("", "user-123", EConnectionType.STEAM),
        ).rejects.toMatchObject({
            status: HttpStatus.BAD_REQUEST,
        });

        await expect(
            service.consumeState(
                null as any,
                "user-123",
                EConnectionType.STEAM,
            ),
        ).rejects.toMatchObject({
            status: HttpStatus.BAD_REQUEST,
        });
    });

    it("should reject with 400 on expired, unknown, or replayed state token", async () => {
        await expect(
            service.consumeState(
                "already-consumed-state",
                "user-123",
                EConnectionType.STEAM,
            ),
        ).rejects.toMatchObject({
            status: HttpStatus.BAD_REQUEST,
        });
        expect(redis.eval).toHaveBeenCalledTimes(1);
    });

    it("should reject with 403 on session mismatch (different userId) and invalidate the state", async () => {
        const storedState = {
            userId: "attacker-456",
            type: EConnectionType.STEAM,
        };
        values.set("conn-auth-state:stolen-state", JSON.stringify(storedState));

        await expect(
            service.consumeState(
                "stolen-state",
                "victim-123",
                EConnectionType.STEAM,
            ),
        ).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
        });

        // State must be deleted to prevent replay
        expect(values.has("conn-auth-state:stolen-state")).toBe(false);
    });

    it("should reject with 403 on provider type mismatch and invalidate the state", async () => {
        const storedState = {
            userId: "user-123",
            type: EConnectionType.STEAM,
        };
        values.set("conn-auth-state:steam-state", JSON.stringify(storedState));

        await expect(
            service.consumeState(
                "steam-state",
                "user-123",
                EConnectionType.XBOX,
            ),
        ).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
        });

        expect(values.has("conn-auth-state:steam-state")).toBe(false);
    });
});
