import { FindManyOptions } from "typeorm";
import { LockoutState } from "../auth/auth.service";
import { Profile } from "../profile/entities/profile.entity";
import { SUPPORTERS_WALL_CACHE_KEY } from "../profile/supporter-preferences/supporter-preferences.cache";
import { SupporterWallItemDto } from "./dto/supporters-wall.dto";
import { SupportersService } from "./supporters.service";

function fixture() {
    const profiles = new Map<string, Profile>();
    const state = {
        supporterIds: [] as string[],
        lockouts: new Map<string, LockoutState>(),
        hiddenIds: [] as string[],
    };
    const repository = {
        find: jest.fn(async (options: FindManyOptions<Profile>) => {
            const ids = (
                options.where as unknown as {
                    userId: { value: string | string[] };
                }
            ).userId.value;
            const idList = Array.isArray(ids) ? ids : [ids];
            return idList
                .map((id) => profiles.get(id))
                .filter((profile): profile is Profile => !!profile)
                .sort((a, b) => a.username.localeCompare(b.username));
        }),
    };
    const billing = {
        findSupporterUserIds: jest.fn(async () => state.supporterIds),
    };
    const auth = {
        getLockoutStates: jest.fn(async () => state.lockouts),
    };
    const preferences = {
        findWallHiddenUserIds: jest.fn(async () => state.hiddenIds),
    };
    const cache = new Map<string, SupporterWallItemDto[]>();
    const cacheManager = {
        get: jest.fn(async (key: string) => cache.get(key)),
        set: jest.fn(
            async (key: string, value: SupporterWallItemDto[]) =>
                void cache.set(key, value),
        ),
        del: jest.fn(async (key: string) => void cache.delete(key)),
    };
    const service = new SupportersService(
        repository as any,
        billing as any,
        auth as any,
        preferences as any,
        cacheManager as any,
    );

    const addProfile = (userId: string, username: string) => {
        profiles.set(userId, { userId, username, avatar: null } as Profile);
    };
    const addProfiles = (count: number) => {
        const ids = Array.from(
            { length: count },
            (_, index) => `user-${String(index + 1).padStart(2, "0")}`,
        );
        ids.forEach((id) => addProfile(id, id));
        return ids;
    };

    return {
        service,
        repository,
        billing,
        auth,
        preferences,
        cacheManager,
        state,
        addProfile,
        addProfiles,
    };
}

describe("SupportersService", () => {
    it("lists supporters with default preferences and excludes opted-out ones", async () => {
        const { service, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        addProfile("u2", "bravo");
        addProfile("u3", "charlie");
        state.supporterIds = ["u1", "u2", "u3"];
        state.hiddenIds = ["u2"];

        const [items, total] = await service.getWall();

        expect(items.map((item) => item.username)).toEqual([
            "alpha",
            "charlie",
        ]);
        expect(total).toBe(2);
    });

    it("excludes banned and suspended supporters", async () => {
        const { service, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        addProfile("u2", "bravo");
        addProfile("u3", "charlie");
        state.supporterIds = ["u1", "u2", "u3"];
        state.lockouts.set("u1", { isSuspended: false, isBanned: true });
        state.lockouts.set("u2", { isSuspended: true, isBanned: false });

        const [items] = await service.getWall();

        expect(items.map((item) => item.userId)).toEqual(["u3"]);
    });

    it("excludes supporters whose entitlement has lapsed", async () => {
        const { service, repository, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        addProfile("u2", "lapsed");
        // findSupporterUserIds already applies grace and paid-period expiry.
        state.supporterIds = ["u1"];

        const [items] = await service.getWall();

        expect(items.map((item) => item.userId)).toEqual(["u1"]);
        const queriedIds = (
            repository.find.mock.calls[0][0].where as {
                userId: { value: string | string[] };
            }
        ).userId.value;
        expect(queriedIds).toEqual(["u1"]);
    });

    it("drops supporter ids without a profile", async () => {
        const { service, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        state.supporterIds = ["u1", "u2"];

        const [items, total] = await service.getWall();

        expect(items.map((item) => item.userId)).toEqual(["u1"]);
        expect(total).toBe(1);
    });

    it("orders profiles by username ascending", async () => {
        const { service, repository, state, addProfile } = fixture();
        addProfile("u2", "bravo");
        addProfile("u1", "alpha");
        addProfile("u3", "charlie");
        state.supporterIds = ["u1", "u2", "u3"];

        const [items] = await service.getWall();

        expect(items.map((item) => item.username)).toEqual([
            "alpha",
            "bravo",
            "charlie",
        ]);
        expect(repository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                relations: { avatar: true },
                order: { username: "ASC" },
            }),
        );
    });

    it("slices pages in memory and reports the total number of supporters", async () => {
        const { service, state, addProfiles } = fixture();
        state.supporterIds = addProfiles(25);

        const [secondPage, total] = await service.getWall(20, 20);
        const [firstTwo] = await service.getWall(0, 2);

        expect(secondPage.map((item) => item.userId)).toEqual([
            "user-21",
            "user-22",
            "user-23",
            "user-24",
            "user-25",
        ]);
        expect(total).toBe(25);
        expect(firstTwo.map((item) => item.userId)).toEqual([
            "user-01",
            "user-02",
        ]);
    });

    it("defaults to a limit of 20", async () => {
        const { service, state, addProfiles } = fixture();
        state.supporterIds = addProfiles(25);

        const [items, total] = await service.getWall();

        expect(items).toHaveLength(20);
        expect(total).toBe(25);
    });

    it("returns only userId, username and avatar in each item", async () => {
        const { service, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        state.supporterIds = ["u1"];

        const [items] = await service.getWall();

        expect(Object.keys(items[0]).sort()).toEqual([
            "avatar",
            "userId",
            "username",
        ]);
    });

    it("caches the whole list under one key and a cache hit runs no queries", async () => {
        const {
            service,
            repository,
            billing,
            auth,
            preferences,
            cacheManager,
            state,
            addProfiles,
        } = fixture();
        state.supporterIds = addProfiles(3);

        const [first] = await service.getWall();
        expect(cacheManager.set).toHaveBeenCalledWith(
            SUPPORTERS_WALL_CACHE_KEY,
            first,
            600_000,
        );

        jest.clearAllMocks();
        const [second, total] = await service.getWall();

        expect(second).toEqual(first);
        expect(total).toBe(3);
        expect(billing.findSupporterUserIds).not.toHaveBeenCalled();
        expect(auth.getLockoutStates).not.toHaveBeenCalled();
        expect(preferences.findWallHiddenUserIds).not.toHaveBeenCalled();
        expect(repository.find).not.toHaveBeenCalled();
        expect(cacheManager.set).not.toHaveBeenCalled();
    });

    it("returns an empty wall when Stripe is not configured", async () => {
        const { service, cacheManager, repository } = fixture();

        const [items, total] = await service.getWall();

        expect(items).toEqual([]);
        expect(total).toBe(0);
        expect(repository.find).not.toHaveBeenCalled();
        expect(cacheManager.set).toHaveBeenCalledWith(
            SUPPORTERS_WALL_CACHE_KEY,
            [],
            600_000,
        );
    });

    it("applies an opt-out on the next read after the cache key is deleted", async () => {
        const { service, cacheManager, state, addProfile } = fixture();
        addProfile("u1", "alpha");
        addProfile("u2", "bravo");
        state.supporterIds = ["u1", "u2"];

        const [before] = await service.getWall();
        expect(before.map((item) => item.userId)).toEqual(["u1", "u2"]);

        // The PATCH deletes the key; the next read has to rebuild the list.
        state.hiddenIds = ["u2"];
        await cacheManager.del(SUPPORTERS_WALL_CACHE_KEY);

        const [after] = await service.getWall();
        expect(after.map((item) => item.userId)).toEqual(["u1"]);
    });
});
