import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, Not, Repository } from "typeorm";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import {
    audienceSatisfiesLevel,
    LibraryAccess,
    LibraryAudience,
    LibraryVisibility,
    visibleEntryLevels,
} from "./library-visibility.constants";

@Injectable()
export class LibraryAccessService {
    constructor(
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(UserFollow)
        private readonly userFollowRepository: Repository<UserFollow>,
        @InjectRepository(CollectionEntry)
        private readonly collectionEntryRepository: Repository<CollectionEntry>,
    ) {}

    /**
     * Resolves what a viewer may see in another user's library. One profile read, plus an uncached
     * follow check only for a signed-in viewer who is not the owner, so follow changes apply on the
     * next call.
     */
    async resolve(
        viewerId: string | undefined,
        ownerId: string,
    ): Promise<LibraryAccess> {
        const profile = await this.profileRepository.findOne({
            where: { userId: ownerId },
            select: { libraryVisibility: true },
        });
        const libraryVisibility =
            profile?.libraryVisibility ?? LibraryVisibility.Public;
        const audience = await this.resolveAudience(viewerId, ownerId);

        return {
            audience,
            libraryVisibility,
            canViewLibrary: audienceSatisfiesLevel(audience, libraryVisibility),
            visibleEntryLevels: visibleEntryLevels(audience, libraryVisibility),
        };
    }

    /**
     * Game ids of the owner's entries whose level is not in `visibleEntryLevels`, sorted
     * ascending. With an empty list every game in the library is hidden.
     */
    async hiddenGameIds(
        ownerId: string,
        visibleEntryLevels: LibraryVisibility[],
    ): Promise<number[]> {
        const where: FindOptionsWhere<CollectionEntry> = {
            libraryUserId: ownerId,
        };
        if (visibleEntryLevels.length > 0) {
            where.visibility = Not(In(visibleEntryLevels));
        }

        const entries = await this.collectionEntryRepository.find({
            select: { gameId: true },
            where,
            order: { gameId: "ASC" },
        });

        return entries.map((entry) => entry.gameId);
    }

    private async resolveAudience(
        viewerId: string | undefined,
        ownerId: string,
    ): Promise<LibraryAudience> {
        if (viewerId === ownerId) {
            return LibraryAudience.Owner;
        }
        if (!viewerId) {
            return LibraryAudience.Everyone;
        }

        const isFollower = await this.userFollowRepository
            .createQueryBuilder("follow")
            .where("follow.followerUserId = :viewerId", { viewerId })
            .andWhere("follow.followedUserId = :ownerId", { ownerId })
            .getExists();

        return isFollower ? LibraryAudience.Follower : LibraryAudience.Everyone;
    }
}
