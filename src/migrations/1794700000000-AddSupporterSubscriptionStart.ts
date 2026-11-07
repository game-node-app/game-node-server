import { MigrationInterface, QueryRunner } from "typeorm";

/** Stores the start of the Stripe subscription that currently grants entitlement (design: supporterSince). */
export class AddSupporterSubscriptionStart1794700000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`CREATE TABLE \`supporter_subscription_start\` (
            \`stripeSubscriptionId\` varchar(255) NOT NULL,
            \`userId\` varchar(36) NOT NULL,
            \`startedAt\` timestamp(3) NOT NULL,
            PRIMARY KEY (\`stripeSubscriptionId\`),
            KEY \`supporter_subscription_start_userId_idx\` (\`userId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `supporter_subscription_start`");
    }
}
