import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * Server-owned start date for the Stripe subscription that grants supporter entitlement.
 * Kept out of the Better Auth Stripe plugin's `subscription` table, which has no such column.
 */
@Entity("supporter_subscription_start")
export class SupporterSubscriptionStart {
    @PrimaryColumn({ type: "varchar", length: 255 })
    stripeSubscriptionId: string;

    @Index("supporter_subscription_start_userId_idx")
    @Column({ type: "varchar", length: 36 })
    userId: string;

    @Column({ type: "timestamp", precision: 3 })
    startedAt: Date;
}
