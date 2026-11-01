import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Creates the tables of Better Auth's jwt() and mcp() (OAuth provider) plugins; cimd() adds none.
 * DDL was generated with better-auth/db/migration from the AuthService config, with foreign keys
 * spelled out because MySQL ignores inline column REFERENCES.
 */
const TABLE_OPTIONS =
    "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";

const TABLES: Record<string, string> = {
    jwks: "`id` varchar(36) NOT NULL PRIMARY KEY, `publicKey` text NOT NULL, `privateKey` text NOT NULL, `createdAt` timestamp(3) NOT NULL, `expiresAt` timestamp(3) NULL, `alg` text, `crv` text",
    oauthClient:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `clientId` varchar(255) NOT NULL UNIQUE, `clientSecret` text, `clientDiscoveryId` text, `disabled` boolean, `skipConsent` boolean, `enableEndSession` boolean, `subjectType` text, `scopes` json, `clientCredentialsScopes` json, `userId` varchar(36), `createdAt` timestamp(3) NULL, `updatedAt` timestamp(3) NULL, `name` text, `uri` text, `icon` text, `contacts` json, `tos` text, `policy` text, `softwareId` text, `softwareVersion` text, `softwareStatement` text, `redirectUris` json NOT NULL, `postLogoutRedirectUris` json, `backchannelLogoutUri` text, `backchannelLogoutSessionRequired` boolean, `tokenEndpointAuthMethod` text, `applicationType` text, `jwks` text, `jwksUri` text, `grantTypes` json, `responseTypes` json, `requirePKCE` boolean, `dpopBoundAccessTokens` boolean, `referenceId` text, `metadata` json, KEY `oauthClient_userId_idx` (`userId`), CONSTRAINT `FK_oauthClient_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE",
    oauthResource:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `identifier` varchar(255) NOT NULL UNIQUE, `name` text NOT NULL, `accessTokenTtl` integer, `refreshTokenTtl` integer, `signingAlgorithm` text, `signingKeyId` text, `allowedScopes` json, `customClaims` json, `dpopBoundAccessTokensRequired` boolean, `disabled` boolean, `createdAt` timestamp(3) NULL, `updatedAt` timestamp(3) NULL, `policyVersion` integer, `metadata` json",
    oauthClientResource:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `clientId` varchar(191) NOT NULL, `resourceId` varchar(191) NOT NULL, `metadata` json, `createdAt` timestamp(3) NULL, KEY `oauthClientResource_clientId_idx` (`clientId`), KEY `oauthClientResource_resourceId_idx` (`resourceId`), UNIQUE KEY `oauthClientResource_clientId_resourceId_uidx` (`clientId`, `resourceId`), CONSTRAINT `FK_oauthClientResource_client` FOREIGN KEY (`clientId`) REFERENCES `oauthClient` (`clientId`) ON DELETE CASCADE, CONSTRAINT `FK_oauthClientResource_resource` FOREIGN KEY (`resourceId`) REFERENCES `oauthResource` (`identifier`) ON DELETE CASCADE",
    oauthRefreshToken:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `token` varchar(255) NOT NULL UNIQUE, `clientId` varchar(36) NOT NULL, `sessionId` varchar(36), `userId` varchar(36) NOT NULL, `referenceId` text, `authorizationCodeId` varchar(255), `resources` json, `requestedUserInfoClaims` json, `expiresAt` timestamp(3) NOT NULL, `createdAt` timestamp(3) NOT NULL, `revoked` timestamp(3) NULL, `rotatedAt` timestamp(3) NULL, `rotationReplayResponse` text, `rotationReplayExpiresAt` timestamp(3) NULL, `authTime` timestamp(3) NULL, `confirmation` json, `scopes` json NOT NULL, KEY `oauthRefreshToken_clientId_idx` (`clientId`), KEY `oauthRefreshToken_sessionId_idx` (`sessionId`), KEY `oauthRefreshToken_userId_idx` (`userId`), KEY `oauthRefreshToken_authorizationCodeId_idx` (`authorizationCodeId`), CONSTRAINT `FK_oauthRefreshToken_client` FOREIGN KEY (`clientId`) REFERENCES `oauthClient` (`clientId`) ON DELETE CASCADE, CONSTRAINT `FK_oauthRefreshToken_session` FOREIGN KEY (`sessionId`) REFERENCES `session` (`id`) ON DELETE SET NULL, CONSTRAINT `FK_oauthRefreshToken_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE",
    oauthAccessToken:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `token` varchar(255) NOT NULL UNIQUE, `clientId` varchar(36) NOT NULL, `sessionId` varchar(36), `userId` varchar(36), `referenceId` text, `authorizationCodeId` varchar(255), `resources` json, `requestedUserInfoClaims` json, `refreshId` varchar(36), `expiresAt` timestamp(3) NOT NULL, `createdAt` timestamp(3) NOT NULL, `revoked` timestamp(3) NULL, `confirmation` json, `scopes` json NOT NULL, KEY `oauthAccessToken_clientId_idx` (`clientId`), KEY `oauthAccessToken_sessionId_idx` (`sessionId`), KEY `oauthAccessToken_userId_idx` (`userId`), KEY `oauthAccessToken_authorizationCodeId_idx` (`authorizationCodeId`), KEY `oauthAccessToken_refreshId_idx` (`refreshId`), CONSTRAINT `FK_oauthAccessToken_client` FOREIGN KEY (`clientId`) REFERENCES `oauthClient` (`clientId`) ON DELETE CASCADE, CONSTRAINT `FK_oauthAccessToken_session` FOREIGN KEY (`sessionId`) REFERENCES `session` (`id`) ON DELETE SET NULL, CONSTRAINT `FK_oauthAccessToken_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE, CONSTRAINT `FK_oauthAccessToken_refresh` FOREIGN KEY (`refreshId`) REFERENCES `oauthRefreshToken` (`id`) ON DELETE CASCADE",
    oauthConsent:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `clientId` varchar(36) NOT NULL, `userId` varchar(36), `referenceId` text, `resources` json, `requestedUserInfoClaims` json, `scopes` json NOT NULL, `createdAt` timestamp(3) NOT NULL, `updatedAt` timestamp(3) NOT NULL, KEY `oauthConsent_clientId_idx` (`clientId`), KEY `oauthConsent_userId_idx` (`userId`), CONSTRAINT `FK_oauthConsent_client` FOREIGN KEY (`clientId`) REFERENCES `oauthClient` (`clientId`) ON DELETE CASCADE, CONSTRAINT `FK_oauthConsent_user` FOREIGN KEY (`userId`) REFERENCES `user` (`id`) ON DELETE CASCADE",
    oauthClientAssertion:
        "`id` varchar(36) NOT NULL PRIMARY KEY, `expiresAt` timestamp(3) NOT NULL",
};

export class AddMcpOAuthProvider1793800000000 implements MigrationInterface {
    name = "AddMcpOAuthProvider1793800000000";

    async up(runner: QueryRunner): Promise<void> {
        for (const [table, columns] of Object.entries(TABLES)) {
            await runner.query(
                `CREATE TABLE \`${table}\` (${columns}) ${TABLE_OPTIONS}`,
            );
        }
    }

    async down(runner: QueryRunner): Promise<void> {
        for (const table of Object.keys(TABLES).reverse()) {
            await runner.query(`DROP TABLE \`${table}\``);
        }
    }
}
