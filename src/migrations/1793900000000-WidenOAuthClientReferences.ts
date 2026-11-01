import { MigrationInterface, QueryRunner } from "typeorm";

export class WidenOAuthClientReferences1793900000000
    implements MigrationInterface
{
    async up(runner: QueryRunner): Promise<void> {
        // CIMD client IDs are URLs; references must match oauthClient.clientId's capacity.
        for (const table of [
            "oauthConsent",
            "oauthRefreshToken",
            "oauthAccessToken",
            "oauthClientResource",
        ]) {
            await runner.query(
                `ALTER TABLE \`${table}\` DROP FOREIGN KEY \`FK_${table}_client\`, MODIFY \`clientId\` varchar(255) NOT NULL, ADD CONSTRAINT \`FK_${table}_client_url\` FOREIGN KEY (\`clientId\`) REFERENCES \`oauthClient\` (\`clientId\`) ON DELETE CASCADE`,
            );
        }
    }

    async down(): Promise<void> {
        throw new Error(
            "Cannot narrow OAuth client IDs without risking data loss",
        );
    }
}
