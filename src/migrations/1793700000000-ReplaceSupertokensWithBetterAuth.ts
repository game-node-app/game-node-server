import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the Better Auth tables (with the admin plugin columns) and drops SuperTokens, linked_provider
 * and user_suspension. DDL was generated with better-auth/db/migration from the AuthService config.
 * Foreign keys are spelled out because MySQL ignores inline column REFERENCES.
 *
 * In prod the SuperTokens core used its own database, so dropping its tables here is a no-op there.
 * down does not restore SuperTokens tables: the core recreates them on boot.
 */
const SUPERTOKENS_TABLES = [
    "all_auth_recipe_users",
    "app_id_to_user_id",
    "apps",
    "bulk_import_users",
    "dashboard_user_sessions",
    "dashboard_users",
    "emailpassword_pswd_reset_tokens",
    "emailpassword_user_to_tenant",
    "emailpassword_users",
    "emailverification_tokens",
    "emailverification_verified_emails",
    "jwt_signing_keys",
    "key_value",
    "oauth_clients",
    "oauth_logout_challenges",
    "oauth_m2m_tokens",
    "oauth_sessions",
    "passwordless_codes",
    "passwordless_devices",
    "passwordless_user_to_tenant",
    "passwordless_users",
    "role_permissions",
    "roles",
    "session_access_token_signing_keys",
    "session_info",
    "tenant_configs",
    "tenant_first_factors",
    "tenant_required_secondary_factors",
    "tenant_thirdparty_provider_clients",
    "tenant_thirdparty_providers",
    "tenants",
    "thirdparty_user_to_tenant",
    "thirdparty_users",
    "totp_used_codes",
    "totp_user_devices",
    "totp_users",
    "user_last_active",
    "user_metadata",
    "user_roles",
    "userid_mapping",
    "webauthn_account_recovery_tokens",
    "webauthn_credentials",
    "webauthn_generated_options",
    "webauthn_user_to_tenant",
    "webauthn_users",
];

const LEGACY_TABLES = [
    "CREATE TABLE `linked_provider` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `userId` varchar(255) NOT NULL,\n  `providerId` varchar(255) NOT NULL,\n  `providerUserId` varchar(255) NOT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `IDX_c1da700f7981f4a82d410d41c7` (`providerId`,`providerUserId`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
    "CREATE TABLE `user_suspension` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `userId` varchar(255) NOT NULL,\n  `tenantId` varchar(255) NOT NULL DEFAULT 'public',\n  `issuerUserId` varchar(255) NOT NULL,\n  `isSuspension` tinyint NOT NULL DEFAULT '0',\n  `isBan` tinyint NOT NULL DEFAULT '1',\n  `endDate` timestamp NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
];

export class ReplaceSupertokensWithBetterAuth1793700000000
    implements MigrationInterface
{
    name = "ReplaceSupertokensWithBetterAuth1793700000000";

    async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            "CREATE TABLE `user` (`id` varchar(36) NOT NULL PRIMARY KEY, `name` varchar(255) NOT NULL, `email` varchar(255) NOT NULL UNIQUE, `emailVerified` boolean NOT NULL, `image` text, `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `role` varchar(255) NOT NULL DEFAULT 'user', `banned` boolean, `banReason` text, `banExpires` timestamp(3) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        await runner.query(
            "CREATE TABLE `session` (`id` varchar(36) NOT NULL PRIMARY KEY, `expiresAt` timestamp(3) NOT NULL, `token` varchar(255) NOT NULL UNIQUE, `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` timestamp(3) NOT NULL, `ipAddress` text, `userAgent` text, `userId` varchar(36) NOT NULL, `impersonatedBy` text, KEY `session_userId_idx` (`userId`), CONSTRAINT `FK_session_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        await runner.query(
            "CREATE TABLE `account` (`id` varchar(36) NOT NULL PRIMARY KEY, `accountId` text NOT NULL, `providerId` text NOT NULL, `userId` varchar(36) NOT NULL, `accessToken` text, `refreshToken` text, `idToken` text, `accessTokenExpiresAt` timestamp(3) NULL, `refreshTokenExpiresAt` timestamp(3) NULL, `scope` text, `password` text, `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` timestamp(3) NOT NULL, KEY `account_userId_idx` (`userId`), CONSTRAINT `FK_account_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        await runner.query(
            "CREATE TABLE `verification` (`id` varchar(36) NOT NULL PRIMARY KEY, `identifier` varchar(255) NOT NULL, `value` text NOT NULL, `expiresAt` timestamp(3) NOT NULL, `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY `verification_identifier_idx` (`identifier`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
        );
        await runner.query("DROP TABLE IF EXISTS `linked_provider`");
        await runner.query("DROP TABLE IF EXISTS `user_suspension`");
        await runner.query("SET FOREIGN_KEY_CHECKS = 0");
        try {
            for (const table of SUPERTOKENS_TABLES) {
                await runner.query(`DROP TABLE IF EXISTS \`${table}\``);
            }
        } finally {
            await runner.query("SET FOREIGN_KEY_CHECKS = 1");
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        for (const table of ["verification", "account", "session", "user"]) {
            await runner.query(`DROP TABLE \`${table}\``);
        }
        for (const ddl of LEGACY_TABLES) {
            await runner.query(ddl);
        }
    }
}
