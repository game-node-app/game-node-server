import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SupporterSubscriptionStart } from "./entity/supporter-subscription-start.entity";

/** Start dates of the Stripe subscriptions that granted entitlement, shared by billing and the auth hooks. */
@Injectable()
export class SupporterSubscriptionStartService {
    constructor(
        @InjectRepository(SupporterSubscriptionStart)
        private readonly repository: Repository<SupporterSubscriptionStart>,
    ) {}

    /** Webhooks can deliver the same subscription more than once or out of order, so upsert on the Stripe id. */
    async record(
        stripeSubscriptionId: string,
        userId: string,
        startedAt: Date,
    ): Promise<void> {
        await this.repository.upsert(
            { stripeSubscriptionId, userId, startedAt },
            ["stripeSubscriptionId"],
        );
    }

    async findStartedAt(stripeSubscriptionId: string): Promise<Date | null> {
        const row = await this.repository.findOneBy({ stripeSubscriptionId });
        return row?.startedAt ?? null;
    }
}
