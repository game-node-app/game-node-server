import { Logger } from "@nestjs/common";
import { ProfileSupporterPreferences } from "../entities/profile-supporter-preferences.entity";
import {
    SUPPORTER_PREFERENCES_DEFAULTS,
    SupporterPreferencesValues,
} from "./supporter-preferences.defaults";
import {
    profilePresenceCacheKey,
    SUPPORTERS_WALL_CACHE_KEY,
} from "./supporter-preferences.cache";
import { SupporterPreferencesService } from "./supporter-preferences.service";

function fixture() {
    let stored: ProfileSupporterPreferences | null = null;
    const repository = {
        findOneBy: jest.fn(async () => stored),
        upsert: jest.fn(
            async (values: Partial<ProfileSupporterPreferences>) => {
                stored = {
                    ...SUPPORTER_PREFERENCES_DEFAULTS,
                    ...stored,
                    ...values,
                } as ProfileSupporterPreferences;
            },
        ),
        find: jest.fn(),
    };
    const cache = { del: jest.fn(async () => true) };
    const service = new SupporterPreferencesService(
        repository as any,
        cache as any,
    );
    return {
        service,
        repository,
        cache,
        store: (values: Partial<SupporterPreferencesValues>) => {
            stored = {
                profileUserId: "user-1",
                ...SUPPORTER_PREFERENCES_DEFAULTS,
                ...values,
            } as ProfileSupporterPreferences;
        },
    };
}

describe("SupporterPreferencesService", () => {
    afterEach(() => jest.restoreAllMocks());

    it("returns a copy of the defaults when no row exists", async () => {
        const { service } = fixture();

        const values = await service.findOrDefaults("user-1");

        expect(values).toEqual(SUPPORTER_PREFERENCES_DEFAULTS);
        expect(values).not.toBe(SUPPORTER_PREFERENCES_DEFAULTS);
        values.showBadge = false;
        expect(SUPPORTER_PREFERENCES_DEFAULTS.showBadge).toBe(true);
    });

    it("returns the stored seven fields when a row exists", async () => {
        const { service, store } = fixture();
        store({
            showBadge: false,
            titleKey: "founder",
            showAnimatedAvatarBorder: false,
            showSupporterTheme: false,
            accentColor: "#FF8800",
            showOnSupportersWall: false,
            showLiveProfile: true,
        });

        await expect(service.findOrDefaults("user-1")).resolves.toEqual({
            showBadge: false,
            titleKey: "founder",
            showAnimatedAvatarBorder: false,
            showSupporterTheme: false,
            accentColor: "#FF8800",
            showOnSupportersWall: false,
            showLiveProfile: true,
        });
    });

    it("upserts only the provided fields and returns the complete result", async () => {
        const { service, repository, cache } = fixture();

        const values = await service.update("user-1", { showBadge: false });

        expect(repository.upsert).toHaveBeenCalledWith(
            { profileUserId: "user-1", showBadge: false },
            ["profileUserId"],
        );
        expect(values).toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showBadge: false,
        });
        expect(cache.del).toHaveBeenCalledWith(SUPPORTERS_WALL_CACHE_KEY);
        expect(cache.del).toHaveBeenCalledWith(
            profilePresenceCacheKey("user-1"),
        );
    });

    it("keeps the other stored fields on a partial update", async () => {
        const { service, store } = fixture();
        store({ titleKey: "founder", accentColor: "#123456" });

        const values = await service.update("user-1", {
            showLiveProfile: true,
        });

        expect(values).toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            titleKey: "founder",
            accentColor: "#123456",
            showLiveProfile: true,
        });
    });

    it("stores null to clear a nullable preference", async () => {
        const { service, repository, store } = fixture();
        store({ titleKey: "founder", accentColor: "#123456" });

        const values = await service.update("user-1", {
            titleKey: null,
            accentColor: null,
        });

        expect(repository.upsert).toHaveBeenCalledWith(
            { profileUserId: "user-1", titleKey: null, accentColor: null },
            ["profileUserId"],
        );
        expect(values.titleKey).toBeNull();
        expect(values.accentColor).toBeNull();
    });

    it("does not write or invalidate for an empty body", async () => {
        const { service, repository, cache } = fixture();

        const values = await service.update("user-1", {});

        expect(repository.upsert).not.toHaveBeenCalled();
        expect(cache.del).not.toHaveBeenCalled();
        expect(values).toEqual(SUPPORTER_PREFERENCES_DEFAULTS);
    });

    it("logs and succeeds when cache invalidation fails", async () => {
        const warn = jest
            .spyOn(Logger.prototype, "warn")
            .mockImplementation(() => undefined);
        const { service, cache } = fixture();
        cache.del.mockRejectedValue(new Error("redis down"));

        await expect(
            service.update("user-1", { showBadge: false }),
        ).resolves.toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showBadge: false,
        });
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("Could not invalidate supporter caches"),
        );
    });

    it("lists the users who opted out of the wall", async () => {
        const { service, repository } = fixture();
        repository.find.mockResolvedValue([
            { profileUserId: "user-1" },
            { profileUserId: "user-2" },
        ]);

        await expect(service.findWallHiddenUserIds()).resolves.toEqual([
            "user-1",
            "user-2",
        ]);
        expect(repository.find).toHaveBeenCalledWith({
            where: { showOnSupportersWall: false },
            select: { profileUserId: true },
        });
    });
});
