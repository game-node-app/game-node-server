import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LinkedProvider } from "./entity/linked-provider.entity";
import { Injectable } from "@nestjs/common";
import supertokens, { User } from "supertokens-node";
import { LibrariesService } from "../../libraries/libraries.service";
import { ProfileService } from "../../profile/profile.service";
import { DEFAULT_TENANT_ID } from "../../auth/auth.constants";

@Injectable()
export class UserAccountService {
    constructor(
        @InjectRepository(LinkedProvider)
        private readonly linkedProviderRepo: Repository<LinkedProvider>,
        private readonly librariesService: LibrariesService,
        private readonly profileService: ProfileService,
    ) {}

    /**
     * Retrieve all SuperTokens user accounts matching the given email.
     * Searches across all login methods.
     */
    async getUsersByEmail(email: string): Promise<User[]> {
        return supertokens.listUsersByAccountInfo(DEFAULT_TENANT_ID, { email });
    }

    async linkAccounts(
        userId: string,
        providerId: string,
        providerUserId: string,
    ) {
        return this.linkedProviderRepo.save({
            userId,
            providerId,
            providerUserId,
        });
    }

    async unlinkAccount(providerId: string, providerUserId: string) {
        return this.linkedProviderRepo.delete({
            providerId,
            providerUserId,
        });
    }

    async getLinkedProviders(userId: string) {
        return this.linkedProviderRepo.find({
            where: { userId },
        });
    }

    async getLinkedProvider(providerId: string, providerUserId: string) {
        return this.linkedProviderRepo.findOne({
            where: { providerId, providerUserId },
        });
    }

    async restartUserAccount(userId: string) {
        await this.librariesService.deleteByUserId(userId);
        await this.profileService.deleteByUserId(userId);
    }
}
