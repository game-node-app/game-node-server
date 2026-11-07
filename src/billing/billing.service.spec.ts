import {
    ConflictException,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../auth/auth.service";
import type { SupporterSubscriptionRow } from "../auth/auth.service";
import { BillingService } from "./billing.service";
import type { CheckoutRequestDto } from "./dto/billing-request.dto";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEBSITE = "https://gamenode.test";

describe("BillingService", () => {
    const authService = {
        stripeEnabled: true,
        stripe: {
            subscriptions: { update: jest.fn(), retrieve: jest.fn() },
        },
        getSubscriptions: jest.fn(),
        auth: {
            api: {
                upgradeSubscription: jest.fn(),
                createBillingPortal: jest.fn(),
            },
        },
    };
    let service: BillingService;

    const row = (
        overrides: Partial<SupporterSubscriptionRow> = {},
    ): SupporterSubscriptionRow => ({
        id: "subscription-row",
        plan: "supporter",
        referenceId: "user-1",
        status: "active",
        ...overrides,
    });

    beforeEach(() => {
        jest.resetAllMocks();
        authService.stripeEnabled = true;
        service = new BillingService(
            authService as unknown as AuthService,
            new ConfigService({ DOMAIN_WEBSITE: WEBSITE }),
        );
    });

    describe("getOffers", () => {
        const cases: Array<{
            country?: string;
            language?: string;
            currency: "BRL" | "USD";
            monthly: number;
            yearly: number;
            monthlyDisplay: string;
            yearlyDisplay: string;
        }> = [
            {
                country: "BR",
                currency: "BRL",
                monthly: 990,
                yearly: 9900,
                monthlyDisplay: "R$ 9,90",
                yearlyDisplay: "R$ 99,00",
            },
            {
                country: "br",
                currency: "BRL",
                monthly: 990,
                yearly: 9900,
                monthlyDisplay: "R$ 9,90",
                yearlyDisplay: "R$ 99,00",
            },
            {
                language: "pt-BR,pt;q=0.9",
                currency: "BRL",
                monthly: 990,
                yearly: 9900,
                monthlyDisplay: "R$ 9,90",
                yearlyDisplay: "R$ 99,00",
            },
            {
                currency: "USD",
                monthly: 190,
                yearly: 1900,
                monthlyDisplay: "US$ 1.90",
                yearlyDisplay: "US$ 19.00",
            },
        ];

        it.each(cases)(
            "returns $currency offers for $country / $language",
            async ({
                country,
                language,
                currency,
                monthly,
                yearly,
                monthlyDisplay,
                yearlyDisplay,
            }) => {
                expect(service.getOffers(country, language)).toEqual({
                    currency,
                    offers: [
                        {
                            plan: "supporter",
                            interval: "monthly",
                            amount: monthly,
                            displayAmount: monthlyDisplay,
                        },
                        {
                            plan: "supporter",
                            interval: "yearly",
                            amount: yearly,
                            displayAmount: yearlyDisplay,
                        },
                    ],
                });
            },
        );
    });

    describe("isSupporter", () => {
        const cases: Array<
            [SupporterSubscriptionRow["status"], Date, boolean]
        > = [
            ["active", new Date(), true],
            ["trialing", new Date(), true],
            ["past_due", new Date(Date.now() - 2 * DAY_MS), true],
            ["past_due", new Date(Date.now() - 4 * DAY_MS), false],
            ["canceled", new Date(Date.now() + DAY_MS), true],
            ["canceled", new Date(Date.now() - DAY_MS), false],
            ["incomplete", new Date(Date.now() + DAY_MS), false],
            ["unpaid", new Date(Date.now() + DAY_MS), false],
            ["paused", new Date(Date.now() + DAY_MS), false],
        ];

        it.each(cases)(
            "%s with period end %s grants %s",
            async (status, periodEnd, expected) => {
                authService.getSubscriptions.mockResolvedValue([
                    row({ status, periodEnd }),
                ]);

                await expect(service.isSupporter("user-1")).resolves.toBe(
                    expected,
                );
            },
        );

        it("is false for a free user", async () => {
            authService.getSubscriptions.mockResolvedValue([]);

            await expect(service.isSupporter("user-1")).resolves.toBe(false);
        });
    });

    describe("getMe", () => {
        it("projects the best row", async () => {
            const periodEnd = new Date("2026-12-01T00:00:00Z");
            authService.getSubscriptions.mockResolvedValue([
                row({
                    id: "past-due",
                    status: "past_due",
                    periodEnd: new Date("2026-06-01T00:00:00Z"),
                    updatedAt: new Date("2026-06-01T00:00:00Z"),
                }),
                row({
                    id: "active",
                    billingInterval: "month",
                    periodEnd,
                    cancelAtPeriodEnd: true,
                    updatedAt: new Date("2026-01-01T00:00:00Z"),
                }),
            ]);

            await expect(service.getMe("user-1")).resolves.toEqual({
                isSupporter: true,
                status: "active",
                plan: "supporter",
                billingInterval: "month",
                periodEnd,
                cancelAtPeriodEnd: true,
            });
        });

        it("returns nulls without a subscription", async () => {
            authService.getSubscriptions.mockResolvedValue([]);

            await expect(service.getMe("user-1")).resolves.toEqual({
                isSupporter: false,
                status: null,
                plan: null,
                billingInterval: null,
                periodEnd: null,
                cancelAtPeriodEnd: null,
            });
        });
    });

    describe("createCheckout", () => {
        const headers = { authorization: "Bearer token" };
        const cases: Array<{
            interval: "monthly" | "yearly";
            annual: boolean;
            locale?: string;
        }> = [
            { interval: "monthly", annual: false },
            { interval: "yearly", annual: true, locale: "pt-BR" },
        ];

        it.each(cases)(
            "creates a $interval checkout with server-owned URLs",
            async ({ interval, annual, locale }) => {
                authService.getSubscriptions.mockResolvedValue([]);
                authService.auth.api.upgradeSubscription.mockResolvedValue({
                    url: "https://checkout.test",
                    redirect: false,
                });

                await expect(
                    service.createCheckout(
                        "user-1",
                        { interval, locale },
                        headers,
                    ),
                ).resolves.toEqual({ url: "https://checkout.test" });

                expect(
                    authService.auth.api.upgradeSubscription,
                ).toHaveBeenCalledWith({
                    body: {
                        plan: "supporter",
                        annual,
                        metadata: { currency: "usd" },
                        successUrl: `${WEBSITE}/supporter?checkout=success`,
                        cancelUrl: `${WEBSITE}/supporter?checkout=cancel`,
                        returnUrl: `${WEBSITE}/supporter`,
                        disableRedirect: true,
                        ...(locale ? { locale } : {}),
                    },
                    headers: expect.anything(),
                });
            },
        );

        it("ignores client-supplied price and currency", async () => {
            authService.getSubscriptions.mockResolvedValue([]);
            authService.auth.api.upgradeSubscription.mockResolvedValue({
                url: "https://checkout.test",
                redirect: false,
            });
            const dto = {
                interval: "monthly",
                priceId: "price_123",
                amount: 1,
                currency: "EUR",
            } as CheckoutRequestDto;

            await service.createCheckout("user-1", dto, headers);

            const [{ body }] =
                authService.auth.api.upgradeSubscription.mock.calls[0];
            expect(body).toEqual({
                plan: "supporter",
                annual: false,
                metadata: { currency: "usd" },
                successUrl: `${WEBSITE}/supporter?checkout=success`,
                cancelUrl: `${WEBSITE}/supporter?checkout=cancel`,
                returnUrl: `${WEBSITE}/supporter`,
                disableRedirect: true,
            });
        });

        it("selects BRL from CF-IPCountry without a client currency", async () => {
            authService.getSubscriptions.mockResolvedValue([]);
            authService.auth.api.upgradeSubscription.mockResolvedValue({
                url: "https://checkout.test",
                redirect: false,
            });

            await service.createCheckout(
                "user-1",
                { interval: "monthly" },
                { authorization: "Bearer token", "cf-ipcountry": "BR" },
            );

            const [{ body }] =
                authService.auth.api.upgradeSubscription.mock.calls[0];
            expect(body.metadata).toEqual({ currency: "brl" });
        });

        it("rejects a second active subscription", async () => {
            authService.getSubscriptions.mockResolvedValue([row()]);

            await expect(
                service.createCheckout(
                    "user-1",
                    { interval: "monthly" },
                    headers,
                ),
            ).rejects.toBeInstanceOf(ConflictException);
            expect(
                authService.auth.api.upgradeSubscription,
            ).not.toHaveBeenCalled();
        });
    });

    describe("createPortal", () => {
        const headers = { authorization: "Bearer token" };

        it("returns 404 without a Stripe customer", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeSubscriptionId: "sub_1" }),
            ]);

            await expect(
                service.createPortal("user-1", {}, headers),
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(
                authService.auth.api.createBillingPortal,
            ).not.toHaveBeenCalled();
        });

        it("returns the portal URL", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeCustomerId: "cus_1" }),
            ]);
            authService.auth.api.createBillingPortal.mockResolvedValue({
                url: "https://portal.test",
                redirect: false,
            });

            await expect(
                service.createPortal("user-1", {}, headers),
            ).resolves.toEqual({ url: "https://portal.test" });
            expect(
                authService.auth.api.createBillingPortal,
            ).toHaveBeenCalledWith({
                body: {
                    returnUrl: `${WEBSITE}/supporter`,
                    disableRedirect: true,
                },
                headers: expect.anything(),
            });
        });

        it("maps a plugin NOT_FOUND to 404", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeCustomerId: "cus_1" }),
            ]);
            authService.auth.api.createBillingPortal.mockRejectedValue(
                Object.assign(new Error("Customer not found"), {
                    status: "NOT_FOUND",
                    statusCode: 404,
                }),
            );

            await expect(
                service.createPortal("user-1", {}, headers),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("cancel", () => {
        const subscription = {
            status: "active",
            items: { data: [{ current_period_end: 1767225600 }] },
        };

        it("cancels at period end", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeSubscriptionId: "sub_1" }),
            ]);
            authService.stripe.subscriptions.update.mockResolvedValue(
                subscription,
            );

            await expect(service.cancel("user-1")).resolves.toEqual({
                status: "active",
                cancelAtPeriodEnd: true,
                periodEnd: new Date(1767225600 * 1000),
            });
            expect(
                authService.stripe.subscriptions.update,
            ).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
        });

        it("returns 404 without an active subscription", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ status: "past_due", stripeSubscriptionId: "sub_1" }),
            ]);

            await expect(service.cancel("user-1")).rejects.toBeInstanceOf(
                NotFoundException,
            );
            expect(
                authService.stripe.subscriptions.update,
            ).not.toHaveBeenCalled();
        });
    });

    describe("restore", () => {
        const subscription = {
            status: "active",
            items: { data: [{ current_period_end: 1767225600 }] },
        };

        it("clears a pending cancellation", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({
                    stripeSubscriptionId: "sub_1",
                    cancelAtPeriodEnd: true,
                }),
            ]);
            authService.stripe.subscriptions.update.mockResolvedValue(
                subscription,
            );

            await expect(service.restore("user-1")).resolves.toEqual({
                status: "active",
                cancelAtPeriodEnd: false,
                periodEnd: new Date(1767225600 * 1000),
            });
            expect(
                authService.stripe.subscriptions.update,
            ).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
        });

        it("returns 404 without an active subscription", async () => {
            authService.getSubscriptions.mockResolvedValue([]);

            await expect(service.restore("user-1")).rejects.toBeInstanceOf(
                NotFoundException,
            );
        });

        it("returns 409 without a pending cancellation", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeSubscriptionId: "sub_1" }),
            ]);
            authService.stripe.subscriptions.retrieve.mockResolvedValue({
                cancel_at_period_end: false,
                cancel_at: null,
            });

            await expect(service.restore("user-1")).rejects.toBeInstanceOf(
                ConflictException,
            );
            expect(
                authService.stripe.subscriptions.update,
            ).not.toHaveBeenCalled();
        });

        it("restores when Stripe has the pending cancellation but the row is stale", async () => {
            authService.getSubscriptions.mockResolvedValue([
                row({ stripeSubscriptionId: "sub_1" }),
            ]);
            authService.stripe.subscriptions.retrieve.mockResolvedValue({
                cancel_at_period_end: true,
                cancel_at: null,
            });
            authService.stripe.subscriptions.update.mockResolvedValue(
                subscription,
            );

            await expect(service.restore("user-1")).resolves.toEqual({
                status: "active",
                cancelAtPeriodEnd: false,
                periodEnd: new Date(1767225600 * 1000),
            });
        });
    });

    describe("when Stripe is disabled", () => {
        const calls: Array<[string, () => Promise<unknown>]> = [
            ["offers", async () => service.getOffers()],
            [
                "checkout",
                () =>
                    service.createCheckout(
                        "user-1",
                        { interval: "monthly" },
                        {},
                    ),
            ],
            ["me", () => service.getMe("user-1")],
            ["portal", () => service.createPortal("user-1", {}, {})],
            ["cancel", () => service.cancel("user-1")],
            ["restore", () => service.restore("user-1")],
        ];

        it.each(calls)("%s returns 503 before any lookup", async (_, call) => {
            authService.stripeEnabled = false;

            await expect(call()).rejects.toBeInstanceOf(
                ServiceUnavailableException,
            );
            expect(authService.getSubscriptions).not.toHaveBeenCalled();
            expect(
                authService.stripe.subscriptions.update,
            ).not.toHaveBeenCalled();
            expect(
                authService.auth.api.upgradeSubscription,
            ).not.toHaveBeenCalled();
            expect(
                authService.auth.api.createBillingPortal,
            ).not.toHaveBeenCalled();
        });
    });
});
