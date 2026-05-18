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

    async getUserById(userId: string): Promise<User | undefined> {
        return supertokens.getUser(userId);
    }

    async getProviderLinkCounts(
        userIds: string[],
    ): Promise<Map<string, number>> {
        if (userIds.length === 0) {
            return new Map();
        }

        const rows = await this.linkedProviderRepo
            .createQueryBuilder("linkedProvider")
            .select("linkedProvider.userId", "userId")
            .addSelect("COUNT(*)", "count")
            .where("linkedProvider.userId IN (:...userIds)", { userIds })
            .groupBy("linkedProvider.userId")
            .getRawMany<{ userId: string; count: string }>();

        const counts = new Map<string, number>();
        for (const row of rows) {
            counts.set(row.userId, Number(row.count));
        }

        return counts;
    }

    async restartUserAccount(userId: string) {
        await this.librariesService.deleteByUserId(userId);
        await this.profileService.deleteByUserId(userId);
    }
}
