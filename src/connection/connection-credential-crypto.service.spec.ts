import { ConfigService } from "@nestjs/config";
import { ConnectionCredentialCryptoService } from "./connection-credential-crypto.service";
import { ConnectionCredentialService } from "./connection-credential.service";
import { Repository } from "typeorm";
import { UserConnectionCredential } from "./entity/user-connection-credential.entity";
import * as crypto from "node:crypto";

describe("ConnectionCredentialCryptoService & ConnectionCredentialService", () => {
    const validHexKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const validBase64Key = Buffer.from(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "hex",
    ).toString("base64");
    const validRaw32Key = "12345678901234567890123456789012";

    describe("ConnectionCredentialCryptoService", () => {
        it("should successfully round-trip encrypt and decrypt with 64 hex chars key", () => {
            const config = {
                get: (k: string) =>
                    k === "CONNECTION_CREDENTIAL_ENCRYPTION_KEY"
                        ? validHexKey
                        : undefined,
            } as unknown as ConfigService;
            const service = new ConnectionCredentialCryptoService(config);
            service.onModuleInit();

            const message = "my-secret-oauth-token-12345";
            const encrypted = service.encrypt(message);
            expect(encrypted).not.toEqual(message);

            const decrypted = service.decrypt(encrypted);
            expect(decrypted).toEqual(message);
        });

        it("should successfully round-trip encrypt and decrypt with 44 base64 chars key", () => {
            const service = new ConnectionCredentialCryptoService({
                get: () => validBase64Key,
            } as unknown as ConfigService);
            service.onModuleInit();

            const message = JSON.stringify({ token: "xsts-token", uhs: "12345" });
            const encrypted = service.encrypt(message);
            const decrypted = service.decrypt(encrypted);
            expect(decrypted).toEqual(message);
        });

        it("should successfully round-trip encrypt and decrypt with 32 bytes raw key", () => {
            const service = new ConnectionCredentialCryptoService({
                get: () => validRaw32Key,
            } as unknown as ConfigService);
            service.onModuleInit();

            const message = "refresh-token-abc";
            const encrypted = service.encrypt(message);
            const decrypted = service.decrypt(encrypted);
            expect(decrypted).toEqual(message);
        });

        it("should reject tampered ciphertext and auth tag", () => {
            const service = new ConnectionCredentialCryptoService({
                get: () => validHexKey,
            } as unknown as ConfigService);
            service.onModuleInit();

            const encrypted = service.encrypt("important-secret");
            const buf = Buffer.from(encrypted, "base64");

            // Tamper with auth tag (bytes 12-27)
            const tamperedTag = Buffer.from(buf);
            tamperedTag[15] ^= 0xff;
            expect(() =>
                service.decrypt(tamperedTag.toString("base64")),
            ).toThrow();

            // Tamper with ciphertext (byte 28+)
            const tamperedCipher = Buffer.from(buf);
            tamperedCipher[tamperedCipher.length - 1] ^= 0xff;
            expect(() =>
                service.decrypt(tamperedCipher.toString("base64")),
            ).toThrow();
        });

        it("should reject truncated ciphertext bundle", () => {
            const service = new ConnectionCredentialCryptoService({
                get: () => validHexKey,
            } as unknown as ConfigService);
            service.onModuleInit();

            const shortBundle = Buffer.from("short").toString("base64");
            expect(() => service.decrypt(shortBundle)).toThrow(
                /bundle length must be at least 28 bytes/,
            );
        });

        it("should fail initialization on missing, empty, or invalid key", () => {
            const emptyService = new ConnectionCredentialCryptoService({
                get: () => "",
            } as unknown as ConfigService);
            expect(() => emptyService.onModuleInit()).toThrow(
                /key is missing or empty/,
            );

            const shortService = new ConnectionCredentialCryptoService({
                get: () => "too-short-key",
            } as unknown as ConfigService);
            expect(() => shortService.onModuleInit()).toThrow(
                /must resolve to 32 bytes/,
            );

            const badHexService = new ConnectionCredentialCryptoService({
                get: () => "0123456789abcdefzzzzzzzz0123456789abcdef0123456789abcdef0123456789",
            } as unknown as ConfigService);
            expect(() => badHexService.onModuleInit()).toThrow(
                /must resolve to 32 bytes/,
            );
        });
    });

    describe("ConnectionCredentialService", () => {
        let cryptoService: ConnectionCredentialCryptoService;
        let credentialRepo: jest.Mocked<Repository<UserConnectionCredential>>;
        let service: ConnectionCredentialService;

        beforeEach(() => {
            cryptoService = new ConnectionCredentialCryptoService({
                get: () => validHexKey,
            } as unknown as ConfigService);
            cryptoService.onModuleInit();

            credentialRepo = {
                save: jest.fn(),
                findOne: jest.fn(),
                delete: jest.fn(),
            } as unknown as jest.Mocked<Repository<UserConnectionCredential>>;

            service = new ConnectionCredentialService(
                credentialRepo,
                cryptoService,
            );
        });

        it("should save encrypted credentials and handle metadata", async () => {
            credentialRepo.save.mockImplementation(async (entity: any) => entity);

            const expires = new Date();
            await service.saveCredentials(42, {
                accessToken: "access-token-123",
                refreshToken: "refresh-token-456",
                expiresAt: expires,
                providerMetadata: { xsts: "xyz" },
            });

            expect(credentialRepo.save).toHaveBeenCalledTimes(1);
            const savedArg = credentialRepo.save.mock.calls[0][0] as any;
            expect(savedArg.connectionId).toBe(42);
            expect(savedArg.accessTokenEncrypted).toBeDefined();
            expect(savedArg.accessTokenEncrypted).not.toBe("access-token-123");
            expect(savedArg.refreshTokenEncrypted).toBeDefined();
            expect(savedArg.refreshTokenEncrypted).not.toBe("refresh-token-456");
            expect(savedArg.expiresAt).toEqual(expires);
            expect(savedArg.providerMetadataEncrypted).toBeDefined();

            // Decrypting the saved fields should match
            expect(
                cryptoService.decrypt(savedArg.accessTokenEncrypted),
            ).toBe("access-token-123");
            expect(
                cryptoService.decrypt(savedArg.refreshTokenEncrypted),
            ).toBe("refresh-token-456");
            expect(
                JSON.parse(
                    cryptoService.decrypt(savedArg.providerMetadataEncrypted),
                ),
            ).toEqual({ xsts: "xyz" });
        });

        it("should get and decrypt credentials, returning null if not found", async () => {
            credentialRepo.findOne.mockResolvedValueOnce(null);
            const notFound = await service.getCredentials(99);
            expect(notFound).toBeNull();

            const encAccess = cryptoService.encrypt("access-abc");
            const encRefresh = cryptoService.encrypt("refresh-def");
            const encMeta = cryptoService.encrypt(JSON.stringify({ uhs: "uhs-1" }));
            const date = new Date();

            credentialRepo.findOne.mockResolvedValueOnce({
                connectionId: 99,
                accessTokenEncrypted: encAccess,
                refreshTokenEncrypted: encRefresh,
                expiresAt: date,
                refreshTokenExpiresAt: date,
                providerMetadataEncrypted: encMeta,
                updatedAt: date,
            } as UserConnectionCredential);

            const creds = await service.getCredentials(99);
            expect(creds).toEqual({
                accessToken: "access-abc",
                refreshToken: "refresh-def",
                expiresAt: date,
                refreshTokenExpiresAt: date,
                providerMetadata: { uhs: "uhs-1" },
            });
        });

        it("should delete credentials by connectionId", async () => {
            await service.deleteCredentials(42);
            expect(credentialRepo.delete).toHaveBeenCalledWith({ connectionId: 42 });
        });
    });
});
