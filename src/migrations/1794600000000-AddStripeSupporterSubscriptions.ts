import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds the Better Auth Stripe plugin schema. Reference: design D4.
 * No foreign key on referenceId (varchar 255 against user.id varchar 36) and no limits column
 * (the 1.7.14 plugin schema does not declare it).
 */
export class AddStripeSupporterSubscriptions1794600000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "ALTER TABLE `user` ADD `stripeCustomerId` varchar(255) NULL, ADD KEY `user_stripeCustomerId_idx` (`stripeCustomerId`)",
        );
        await runner.query(`CREATE TABLE \`subscription\` (
            \`id\` varchar(36) NOT NULL,
            \`plan\` varchar(255) NOT NULL,
            \`referenceId\` varchar(255) NOT NULL,
            \`stripeCustomerId\` varchar(255) NULL,
            \`stripeSubscriptionId\` varchar(255) NULL,
            \`status\` varchar(255) NOT NULL DEFAULT 'incomplete',
            \`periodStart\` timestamp(3) NULL,
            \`periodEnd\` timestamp(3) NULL,
            \`trialStart\` timestamp(3) NULL,
            \`trialEnd\` timestamp(3) NULL,
            \`cancelAt\` timestamp(3) NULL,
            \`canceledAt\` timestamp(3) NULL,
            \`endedAt\` timestamp(3) NULL,
            \`cancelAtPeriodEnd\` boolean NOT NULL DEFAULT false,
            \`seats\` int NULL,
            \`billingInterval\` varchar(255) NULL,
            \`stripeScheduleId\` varchar(255) NULL,
            \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (\`id\`),
            KEY \`subscription_referenceId_idx\` (\`referenceId\`),
            KEY \`subscription_stripeCustomerId_idx\` (\`stripeCustomerId\`),
            UNIQUE KEY \`subscription_stripeSubscriptionId_unique\` (\`stripeSubscriptionId\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query("DROP TABLE `subscription`");
        await runner.query(
            "ALTER TABLE `user` DROP KEY `user_stripeCustomerId_idx`, DROP COLUMN `stripeCustomerId`",
        );
    }
}
