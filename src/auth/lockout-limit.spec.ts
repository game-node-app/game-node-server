import { AuthService } from "./auth.service";
import type { SupporterSubscriptionRow } from "./auth.service";
import { ProfileService } from "../profile/profile.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const ADAPTER_DEFAULT_LIMIT = 100;

type UserRow = {
    id: string;
    banned?: boolean | null;
    banExpires?: Date | null;
};

type Row = UserRow | SupporterSubscriptionRow;

type Where = { field: string; operator?: "in"; value: unknown };

/**
 * Better Auth's adapter returns at most 100 rows unless `limit` is passed, so the fake does too.
 */
function fakeAuthService(options: {
    users?: UserRow[];
    subscriptions?: SupporterSubscriptionRow[];
    stripeEnabled?: boolean;
}) {
    const rowsFor = (model: string): Row[] =>
        model === "user"
            ? (options.users ?? [])
            : (options.subscriptions ?? []);

    const matching = (model: string, where: Where[] = []) =>
        rowsFor(model).filter((row) =>
            where.every(({ field, operator, value }) => {
                const fieldValue = (row as Record<string, unknown>)[field];
                return operator === "in"
                    ? Array.isArray(value) && value.includes(fieldValue)
                    : fieldValue === value;
            }),
        );

    const findMany = jest.fn(
        async ({
            model,
            where,
            limit,
        }: {
            model: string;
            where?: Where[];
            limit?: number;
        }) => matching(model, where).slice(0, limit ?? ADAPTER_DEFAULT_LIMIT),
    );
    const count = jest.fn(
        async ({ model, where }: { model: string; where?: Where[] }) =>
            matching(model, where).length,
    );

    const service = Object.create(AuthService.prototype);
    service.stripeEnabled = options.stripeEnabled ?? true;
    service.auth = {
        $context: Promise.resolve({ adapter: { findMany, count } }),
    };
    return { service: service as AuthService, findMany, count };
}

describe("AuthService.getLockoutStates", () => {
    it("evaluates every id beyond the adapter default of 100", async () => {
        const users = Array.from({ length: 101 }, (_, index) => ({
            id: `user-${index}`,
            banned: index === 100,
            banExpires: null,
        }));
        const { service, findMany } = fakeAuthService({ users });

        const states = await service.getLockoutStates(
            users.map(({ id }) => id),
        );

        expect(states.size).toBe(101);
        expect(states.get("user-100")).toEqual({
            isSuspended: false,
            isBanned: true,
        });
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 101 }),
        );
    });
});

describe("ProfileService.findAll", () => {
    it("reports lockout flags for more than 100 profiles", async () => {
        const profiles = Array.from({ length: 101 }, (_, index) => ({
            userId: `user-${index}`,
        }));
        const { service: authService, findMany } = fakeAuthService({
            users: [
                {
                    id: "user-5",
                    banned: true,
                    banExpires: new Date(Date.now() + DAY_MS),
                },
                { id: "user-77", banned: true, banExpires: null },
                { id: "user-100", banned: true, banExpires: null },
            ],
        });
        const service = new ProfileService(
            { find: async () => profiles } as never,
            {} as never,
            authService,
            {} as never,
        );

        const result = await service.findAll();

        expect(result).toHaveLength(101);
        expect(result[0]).toMatchObject({
            isSuspended: false,
            isBanned: false,
        });
        expect(result[5]).toMatchObject({
            isSuspended: true,
            isBanned: false,
        });
        expect(result[77]).toMatchObject({
            isSuspended: false,
            isBanned: true,
        });
        expect(result[100]).toMatchObject({
            isSuspended: false,
            isBanned: true,
        });
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "user",
                limit: 101,
                where: [
                    {
                        field: "id",
                        operator: "in",
                        value: profiles.map(({ userId }) => userId),
                    },
                ],
            }),
        );
    });
});

describe("AuthService.listSubscriptionsByStatuses", () => {
    const statuses: SupporterSubscriptionRow["status"][] = [
        "active",
        "trialing",
        "past_due",
        "canceled",
    ];

    it("returns [] when Stripe is not configured", async () => {
        const { service, findMany, count } = fakeAuthService({
            stripeEnabled: false,
            subscriptions: [
                {
                    id: "sub-1",
                    plan: "supporter",
                    referenceId: "user-1",
                    status: "active",
                },
            ],
        });

        await expect(
            service.listSubscriptionsByStatuses(statuses),
        ).resolves.toEqual([]);
        expect(count).not.toHaveBeenCalled();
        expect(findMany).not.toHaveBeenCalled();
    });

    it("filters by status", async () => {
        const { service } = fakeAuthService({
            subscriptions: [
                {
                    id: "sub-active",
                    plan: "supporter",
                    referenceId: "user-active",
                    status: "active",
                },
                {
                    id: "sub-paused",
                    plan: "supporter",
                    referenceId: "user-paused",
                    status: "paused",
                },
            ],
        });

        const rows = await service.listSubscriptionsByStatuses(statuses);

        expect(rows.map(({ id }) => id)).toEqual(["sub-active"]);
    });

    it("reads every row when there are more than 100", async () => {
        const subscriptions = Array.from(
            { length: 150 },
            (_, index): SupporterSubscriptionRow => ({
                id: `sub-${index}`,
                plan: "supporter",
                referenceId: `user-${index}`,
                status: "active",
            }),
        );
        const { service, findMany, count } = fakeAuthService({
            subscriptions,
        });

        const rows = await service.listSubscriptionsByStatuses(statuses);

        expect(rows).toHaveLength(150);
        expect(rows[149].referenceId).toBe("user-149");
        expect(count).toHaveBeenCalledWith({
            model: "subscription",
            where: [{ field: "status", operator: "in", value: statuses }],
        });
        expect(findMany).toHaveBeenCalledWith({
            model: "subscription",
            where: [{ field: "status", operator: "in", value: statuses }],
            limit: 150,
        });
    });
});
