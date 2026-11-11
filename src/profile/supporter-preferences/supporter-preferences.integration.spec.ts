import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { BillingService } from "../../billing/billing.service";
import { ProfileSupporterPreferences } from "../entities/profile-supporter-preferences.entity";
import { ProfileVideo } from "../entities/profile-video.entity";
import { Profile } from "../entities/profile.entity";
import { ProfileService } from "../profile.service";
import { SUPPORTER_PREFERENCES_DEFAULTS } from "./supporter-preferences.defaults";
import { SupporterPreferencesService } from "./supporter-preferences.service";

describe("Supporter preferences persistence (MySQL)", () => {
    let dataSource: DataSource;
    let service: SupporterPreferencesService;
    let profiles: ProfileService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new SupporterPreferencesService(
            dataSource.getRepository(ProfileSupporterPreferences),
            { del: jest.fn() } as any,
        );
        profiles = new ProfileService(
            dataSource.getRepository(Profile),
            dataSource.getRepository(ProfileVideo),
            {} as any,
            { delete: jest.fn() } as any,
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function createProfile(): Promise<string> {
        const userId = randomUUID();
        await dataSource.getRepository(Profile).insert({
            userId,
            username: `pref-${userId.slice(0, 8)}`,
        });
        return userId;
    }

    it("applies the column defaults on the first partial save", async () => {
        const userId = await createProfile();

        const values = await service.update(userId, { showBadge: false });

        expect(values).toEqual({
            ...SUPPORTER_PREFERENCES_DEFAULTS,
            showBadge: false,
        });
        await dataSource.getRepository(Profile).delete({ userId });
    });

    it("removes the preferences row when the account is deleted", async () => {
        const userId = await createProfile();
        await service.update(userId, {
            showBadge: false,
            accentColor: "#FF8800",
        });

        // The same path UserAccountService uses to delete an account.
        await profiles.deleteByUserId(userId);

        expect(
            await dataSource
                .getRepository(ProfileSupporterPreferences)
                .countBy({ profileUserId: userId }),
        ).toBe(0);
        expect(
            await dataSource.getRepository(Profile).countBy({ userId }),
        ).toBe(0);
    });

    it("keeps the stored preferences through a loss of entitlement", async () => {
        const userId = await createProfile();
        const stored = await service.update(userId, {
            titleKey: "founder",
            accentColor: "#123456",
            showLiveProfile: true,
            showOnSupportersWall: false,
        });
        const billing = new BillingService(
            {
                getSubscriptions: jest.fn(async () => [
                    {
                        id: "sub-1",
                        plan: "supporter",
                        referenceId: userId,
                        status: "canceled" as const,
                        periodEnd: new Date(Date.now() - 86_400_000),
                    },
                ]),
            } as any,
            {} as any,
            { getOrThrow: () => "http://x" } as any,
        );

        expect(await billing.isSupporter(userId)).toBe(false);
        await expect(service.findOrDefaults(userId)).resolves.toEqual(stored);
        expect(await service.findWallHiddenUserIds()).toContain(userId);

        await dataSource.getRepository(Profile).delete({ userId });
    });

    it("returns the stored preferences again when entitlement resumes", async () => {
        const userId = await createProfile();
        const stored = await service.update(userId, {
            titleKey: "founder",
            accentColor: "#123456",
        });
        const billing = new BillingService(
            {
                getSubscriptions: jest.fn(async () => [
                    {
                        id: "sub-1",
                        plan: "supporter",
                        referenceId: userId,
                        status: "active" as const,
                    },
                ]),
            } as any,
            {} as any,
            { getOrThrow: () => "http://x" } as any,
        );

        expect(await billing.isSupporter(userId)).toBe(true);
        await expect(service.findOrDefaults(userId)).resolves.toEqual(stored);

        await dataSource.getRepository(Profile).delete({ userId });
    });
});
