import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "node:crypto";

@Injectable()
export class ConnectionCredentialCryptoService implements OnModuleInit {
    private keyBuffer: Buffer;

    constructor(private readonly configService?: ConfigService) {}

    onModuleInit(): void {
        const key =
            this.configService?.get<string>("CONNECTION_CREDENTIAL_ENCRYPTION_KEY") ||
            process.env.CONNECTION_CREDENTIAL_ENCRYPTION_KEY;
        this.initializeKey(key);
    }

    public initializeKey(key?: string): void {
        if (!key || typeof key !== "string" || key.trim().length === 0) {
            throw new Error(
                "Invalid CONNECTION_CREDENTIAL_ENCRYPTION_KEY: key is missing or empty",
            );
        }

        const trimmed = key.trim();
        let parsed: Buffer | null = null;

        if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
            parsed = Buffer.from(trimmed, "hex");
        } else if (
            trimmed.length === 44 &&
            /^[A-Za-z0-9+/=]+$/.test(trimmed)
        ) {
            const b64 = Buffer.from(trimmed, "base64");
            if (b64.length === 32) {
                parsed = b64;
            }
        } else if (Buffer.byteLength(trimmed, "utf8") === 32) {
            parsed = Buffer.from(trimmed, "utf8");
        }

        if (!parsed || parsed.length !== 32) {
            throw new Error(
                "Invalid CONNECTION_CREDENTIAL_ENCRYPTION_KEY: must resolve to 32 bytes (64 hex chars or 44 base64 chars)",
            );
        }

        this.keyBuffer = parsed;
    }

    public encrypt(plaintext: string): string {
        if (!this.keyBuffer) {
            throw new Error(
                "ConnectionCredentialCryptoService is not initialized with an encryption key",
            );
        }
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this.keyBuffer, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, "utf8"),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        // 12 bytes IV + 16 bytes Auth Tag + encrypted data
        return Buffer.concat([iv, authTag, encrypted]).toString("base64");
    }

    public decrypt(ciphertextBundle: string): string {
        if (!this.keyBuffer) {
            throw new Error(
                "ConnectionCredentialCryptoService is not initialized with an encryption key",
            );
        }
        const buffer = Buffer.from(ciphertextBundle, "base64");
        if (buffer.length < 28) {
            throw new Error(
                "Invalid ciphertext bundle: bundle length must be at least 28 bytes",
            );
        }

        const iv = buffer.subarray(0, 12);
        const authTag = buffer.subarray(12, 28);
        const ciphertext = buffer.subarray(28);

        const decipher = crypto.createDecipheriv("aes-256-gcm", this.keyBuffer, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return decrypted.toString("utf8");
    }
}
