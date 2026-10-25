import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserConnectionCredential } from "./entity/user-connection-credential.entity";
import { ConnectionCredentialCryptoService } from "./connection-credential-crypto.service";

export interface PlaintextConnectionCredentials {
    accessToken: string;
    refreshToken?: string | null;
    expiresAt?: Date | null;
    refreshTokenExpiresAt?: Date | null;
    providerMetadata?: Record<string, any> | null;
}

@Injectable()
export class ConnectionCredentialService {
    constructor(
        @InjectRepository(UserConnectionCredential)
        private readonly credentialRepository: Repository<UserConnectionCredential>,
        private readonly cryptoService: ConnectionCredentialCryptoService,
    ) {}

    async saveCredentials(
        connectionId: number,
        credentials: PlaintextConnectionCredentials,
    ): Promise<UserConnectionCredential> {
        const accessTokenEncrypted = this.cryptoService.encrypt(
            credentials.accessToken,
        );
        const refreshTokenEncrypted = credentials.refreshToken
            ? this.cryptoService.encrypt(credentials.refreshToken)
            : null;
        const providerMetadataEncrypted = credentials.providerMetadata
            ? this.cryptoService.encrypt(
                  JSON.stringify(credentials.providerMetadata),
              )
            : null;

        return await this.credentialRepository.save({
            connectionId,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            expiresAt: credentials.expiresAt ?? null,
            refreshTokenExpiresAt: credentials.refreshTokenExpiresAt ?? null,
            providerMetadataEncrypted,
        });
    }

    async getCredentials(
        connectionId: number,
    ): Promise<PlaintextConnectionCredentials | null> {
        const record = await this.credentialRepository.findOne({
            where: { connectionId },
        });
        if (!record) {
            return null;
        }

        const accessToken = this.cryptoService.decrypt(
            record.accessTokenEncrypted,
        );
        const refreshToken = record.refreshTokenEncrypted
            ? this.cryptoService.decrypt(record.refreshTokenEncrypted)
            : null;

        let providerMetadata: Record<string, any> | null = null;
        if (record.providerMetadataEncrypted) {
            const decrypted = this.cryptoService.decrypt(
                record.providerMetadataEncrypted,
            );
            providerMetadata = JSON.parse(decrypted);
        }

        return {
            accessToken,
            refreshToken,
            expiresAt: record.expiresAt,
            refreshTokenExpiresAt: record.refreshTokenExpiresAt,
            providerMetadata,
        };
    }

    async deleteCredentials(connectionId: number): Promise<void> {
        await this.credentialRepository.delete({ connectionId });
    }
}
