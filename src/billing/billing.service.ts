import {
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CheckoutSessionLocale } from "@better-auth/stripe";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "http";
import type Stripe from "stripe";
import { AuthService } from "../auth/auth.service";
import type { SupporterSubscriptionRow } from "../auth/auth.service";
import { SupporterSubscriptionStartService } from "./supporter-subscription-start.service";
import type {
    CheckoutRequestDto,
    PortalRequestDto,
} from "./dto/billing-request.dto";
import type {
    BillingCheckoutResponseDto,
    BillingMeResponseDto,
    BillingOffersResponseDto,
    BillingPortalResponseDto,
    BillingSubscriptionActionResponseDto,
} from "./dto/billing-response.dto";
import { resolveSupporterCurrency } from "./supporter-currency";

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

@Injectable()
export class BillingService {
    private readonly websiteUrl: string;
    private readonly logger = new Logger(BillingService.name);

    constructor(
        private readonly authService: AuthService,
        private readonly supporterStarts: SupporterSubscriptionStartService,
        configService: ConfigService,
    ) {
        this.websiteUrl = configService.getOrThrow<string>("DOMAIN_WEBSITE");
    }

    getOffers(
        country?: string,
        acceptLanguage?: string,
    ): BillingOffersResponseDto {
        this.requireStripe();

        const brl = resolveSupporterCurrency(country, acceptLanguage) === "BRL";

        return brl
            ? {
                  currency: "BRL",
                  offers: [
                      {
                          plan: "supporter",
                          interval: "monthly",
                          amount: 990,
                          displayAmount: "R$ 9,90",
                      },
                      {
                          plan: "supporter",
                          interval: "yearly",
                          amount: 9900,
                          displayAmount: "R$ 99,00",
                      },
                  ],
              }
            : {
                  currency: "USD",
                  offers: [
                      {
                          plan: "supporter",
                          interval: "monthly",
                          amount: 190,
                          displayAmount: "US$ 1.90",
                      },
                      {
                          plan: "supporter",
                          interval: "yearly",
                          amount: 1900,
                          displayAmount: "US$ 19.00",
                      },
                  ],
              };
    }

    async isSupporter(userId: string): Promise<boolean> {
        const rows = await this.authService.getSubscriptions(userId);
        return rows.some((row) => this.grantsEntitlement(row));
    }

    async findSupporterUserIds(): Promise<string[]> {
        const rows = await this.authService.listSubscriptionsByStatuses([
            "active",
            "trialing",
            "past_due",
            "canceled",
        ]);
        return [
            ...new Set(
                rows
                    .filter((row) => this.grantsEntitlement(row))
                    .map((row) => row.referenceId),
            ),
        ];
    }

    async getMe(userId: string): Promise<BillingMeResponseDto> {
        this.requireStripe();

        const rows = await this.authService.getSubscriptions(userId);
        const best = this.pickBestRow(rows);
        const isSupporter = rows.some((row) => this.grantsEntitlement(row));

        return {
            isSupporter,
            status: best?.status ?? null,
            plan: best?.plan ?? null,
            billingInterval: best?.billingInterval ?? null,
            periodEnd: best?.periodEnd ?? null,
            cancelAtPeriodEnd: best?.cancelAtPeriodEnd ?? null,
            supporterSince: isSupporter
                ? await this.findSupporterSince(best)
                : null,
        };
    }

    async createCheckout(
        userId: string,
        dto: CheckoutRequestDto,
        headers: IncomingHttpHeaders,
    ): Promise<BillingCheckoutResponseDto> {
        this.requireStripe();

        const rows = await this.authService.getSubscriptions(userId);
        if (
            rows.some(
                (row) => row.status === "active" || row.status === "trialing",
            )
        ) {
            throw new ConflictException(
                "An active subscription already exists; manage it instead",
            );
        }

        const header = (name: string) => {
            const value = headers[name];
            return Array.isArray(value) ? value[0] : value;
        };
        const { url } = await this.authService.auth.api.upgradeSubscription({
            body: {
                plan: "supporter",
                annual: dto.interval === "yearly",
                metadata: {
                    currency:
                        resolveSupporterCurrency(
                            header("cf-ipcountry"),
                            header("accept-language"),
                        ) === "BRL"
                            ? "brl"
                            : "usd",
                },
                successUrl: this.supporterSettingsUrl("success"),
                cancelUrl: this.supporterSettingsUrl("cancel"),
                returnUrl: this.supporterSettingsUrl(),
                disableRedirect: true,
                ...(dto.locale
                    ? { locale: dto.locale as CheckoutSessionLocale }
                    : {}),
            },
            headers: fromNodeHeaders(headers),
        });

        // disableRedirect makes the plugin return { url, redirect }, never a null session URL.
        return { url: url! };
    }

    async createPortal(
        userId: string,
        dto: PortalRequestDto,
        headers: IncomingHttpHeaders,
    ): Promise<BillingPortalResponseDto> {
        this.requireStripe();

        const rows = await this.authService.getSubscriptions(userId);
        if (!rows.some((row) => row.stripeCustomerId)) {
            throw new NotFoundException("No Stripe customer for this user");
        }

        try {
            const { url } = await this.authService.auth.api.createBillingPortal(
                {
                    body: {
                        returnUrl: this.supporterSettingsUrl(),
                        disableRedirect: true,
                        ...(dto.locale
                            ? { locale: dto.locale as CheckoutSessionLocale }
                            : {}),
                    },
                    headers: fromNodeHeaders(headers),
                },
            );
            return { url };
        } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 404) {
                throw new NotFoundException("No billing portal available");
            }
            throw error;
        }
    }

    async cancel(
        userId: string,
    ): Promise<BillingSubscriptionActionResponseDto> {
        const stripe = this.requireStripe();
        const row = await this.findActiveRow(userId);

        if (!row?.stripeSubscriptionId) {
            throw new NotFoundException("No active subscription");
        }

        const subscription = await stripe.subscriptions.update(
            row.stripeSubscriptionId,
            { cancel_at_period_end: true },
        );

        return {
            status: subscription.status,
            cancelAtPeriodEnd: true,
            periodEnd: this.periodEndOf(subscription),
        };
    }

    async restore(
        userId: string,
    ): Promise<BillingSubscriptionActionResponseDto> {
        const stripe = this.requireStripe();
        const row = await this.findActiveRow(userId);

        if (!row?.stripeSubscriptionId) {
            throw new NotFoundException("No active subscription");
        }
        if (!row.cancelAtPeriodEnd && !row.cancelAt) {
            // The webhook may not have synced a cancellation made here or in the Customer Portal yet.
            const current = await stripe.subscriptions.retrieve(
                row.stripeSubscriptionId,
            );
            if (!current.cancel_at_period_end && !current.cancel_at) {
                throw new ConflictException(
                    "The subscription has no pending cancellation",
                );
            }
        }

        const subscription = await stripe.subscriptions.update(
            row.stripeSubscriptionId,
            { cancel_at_period_end: false },
        );

        return {
            status: subscription.status,
            cancelAtPeriodEnd: false,
            periodEnd: this.periodEndOf(subscription),
        };
    }

    /**
     * Stripe's subscription.start_date, stable across renewals and plan switches. Rows created before
     * the table existed are filled on first read; a Stripe failure must not fail /me.
     */
    private async findSupporterSince(
        best: SupporterSubscriptionRow | undefined,
    ): Promise<Date | null> {
        const stripeSubscriptionId = best?.stripeSubscriptionId;
        if (!stripeSubscriptionId) return null;

        const stored =
            await this.supporterStarts.findStartedAt(stripeSubscriptionId);
        if (stored) return stored;

        try {
            const subscription =
                await this.requireStripe().subscriptions.retrieve(
                    stripeSubscriptionId,
                );
            const startedAt = new Date(subscription.start_date * 1000);
            await this.supporterStarts.record(
                subscription.id,
                best.referenceId,
                startedAt,
            );
            return startedAt;
        } catch (error) {
            this.logger.warn(
                `Could not resolve supporter start for ${stripeSubscriptionId}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return null;
        }
    }

    /** Billing lives in the website's settings tab. */
    private supporterSettingsUrl(checkout?: "success" | "cancel"): string {
        return `${this.websiteUrl}/home?settings=premium${
            checkout ? `&checkout=${checkout}` : ""
        }`;
    }

    private requireStripe(): Stripe {
        const stripe = this.authService.stripe;
        if (!this.authService.stripeEnabled || !stripe) {
            throw new ServiceUnavailableException("Billing is not configured");
        }
        return stripe;
    }

    private async findActiveRow(
        userId: string,
    ): Promise<SupporterSubscriptionRow | undefined> {
        const best = this.pickBestRow(
            await this.authService.getSubscriptions(userId),
        );
        return best?.status === "active" || best?.status === "trialing"
            ? best
            : undefined;
    }

    private grantsEntitlement(row: SupporterSubscriptionRow): boolean {
        const periodEnd = row.periodEnd
            ? new Date(row.periodEnd).getTime()
            : null;

        switch (row.status) {
            case "active":
            case "trialing":
                return true;
            case "past_due":
                return (
                    periodEnd !== null &&
                    periodEnd + GRACE_PERIOD_MS > Date.now()
                );
            case "canceled":
                return periodEnd !== null && periodEnd > Date.now();
            default:
                return false;
        }
    }

    private pickBestRow(
        rows: SupporterSubscriptionRow[],
    ): SupporterSubscriptionRow | undefined {
        const priority = (row: SupporterSubscriptionRow) =>
            row.status === "active" || row.status === "trialing"
                ? 0
                : row.status === "past_due"
                  ? 1
                  : 2;

        return [...rows].sort(
            (a, b) =>
                priority(a) - priority(b) ||
                new Date(b.updatedAt ?? 0).getTime() -
                    new Date(a.updatedAt ?? 0).getTime(),
        )[0];
    }

    /** stripe@23 exposes the current period on the subscription item, not the subscription. */
    private periodEndOf(subscription: Stripe.Subscription): Date | null {
        const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
        return currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null;
    }
}
