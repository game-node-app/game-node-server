export class BillingOfferDto {
    plan: "supporter";
    interval: "monthly" | "yearly";
    /** Minor units. */
    amount: number;
    displayAmount: string;
}

export class BillingOffersResponseDto {
    currency: "BRL" | "USD";
    offers: BillingOfferDto[];
}

export class BillingCheckoutResponseDto {
    url: string;
}

export class BillingMeResponseDto {
    isSupporter: boolean;
    status: string | null;
    plan: string | null;
    billingInterval: string | null;
    periodEnd: Date | null;
    cancelAtPeriodEnd: boolean | null;
    /** Start of the current continuous subscription; null unless isSupporter. */
    supporterSince: Date | null;
}

export class BillingPortalResponseDto {
    url: string;
}

export class BillingSubscriptionActionResponseDto {
    status: string;
    cancelAtPeriodEnd: boolean;
    periodEnd: Date | null;
}
