import { In, Repository } from "typeorm";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { LibraryAccessService } from "./library-access.service";
import {
    LibraryAudience,
    LibraryVisibility,
} from "./library-visibility.constants";

type AccessProfile = Pick<Profile, "userId" | "libraryVisibility">;

const ALL_LEVELS = [
    LibraryVisibility.Public,
    LibraryVisibility.Followers,
    LibraryVisibility.Private,
];

function profile(
    userId: string,
    libraryVisibility: LibraryVisibility,
): AccessProfile {
    return { userId, libraryVisibility };
}

function fixture() {
    const userFollowRepository = {
        find: jest.fn(async (): Promise<{ followedUserId: string }[]> => []),
    };
    const service = new LibraryAccessService(
        {} as Repository<Profile>,
        userFollowRepository as unknown as Repository<UserFollow>,
        {} as Repository<CollectionEntry>,
    );
    return { service, userFollowRepository };
}

describe("LibraryAccessService.resolveMany", () => {
    it("returns an empty map without queries when there are no profiles", async () => {
        const { service, userFollowRepository } = fixture();

        await expect(service.resolveMany("viewer", [])).resolves.toEqual(
            new Map(),
        );
        expect(userFollowRepository.find).not.toHaveBeenCalled();
    });

    it("resolves every level for an anonymous viewer without follow queries", async () => {
        const { service, userFollowRepository } = fixture();

        const access = await service.resolveMany(undefined, [
            profile("public", LibraryVisibility.Public),
            profile("followers", LibraryVisibility.Followers),
            profile("private", LibraryVisibility.Private),
        ]);

        expect(access.get("public")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Public,
            canViewLibrary: true,
            visibleEntryLevels: [LibraryVisibility.Public],
        });
        expect(access.get("followers")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Followers,
            canViewLibrary: false,
            visibleEntryLevels: [],
        });
        expect(access.get("private")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Private,
            canViewLibrary: false,
            visibleEntryLevels: [],
        });
        expect(userFollowRepository.find).not.toHaveBeenCalled();
    });

    it("gives the owner full access and skips follow queries", async () => {
        const { service, userFollowRepository } = fixture();

        const access = await service.resolveMany("owner", [
            profile("owner", LibraryVisibility.Private),
            profile("other", LibraryVisibility.Public),
        ]);

        expect(access.get("owner")).toEqual({
            audience: LibraryAudience.Owner,
            libraryVisibility: LibraryVisibility.Private,
            canViewLibrary: true,
            visibleEntryLevels: ALL_LEVELS,
        });
        expect(access.get("other")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Public,
            canViewLibrary: true,
            visibleEntryLevels: [LibraryVisibility.Public],
        });
        expect(userFollowRepository.find).not.toHaveBeenCalled();
    });

    it("checks follows once for the non-owned followers libraries in the batch", async () => {
        const { service, userFollowRepository } = fixture();
        userFollowRepository.find.mockResolvedValue([
            { followedUserId: "followed" },
        ]);

        const access = await service.resolveMany("viewer", [
            profile("followed", LibraryVisibility.Followers),
            profile("not-followed", LibraryVisibility.Followers),
            profile("public", LibraryVisibility.Public),
            profile("private", LibraryVisibility.Private),
            profile("viewer", LibraryVisibility.Private),
        ]);

        expect(userFollowRepository.find).toHaveBeenCalledTimes(1);
        expect(userFollowRepository.find).toHaveBeenCalledWith({
            where: {
                followerUserId: "viewer",
                followedUserId: In(["followed", "not-followed"]),
            },
            select: { followedUserId: true },
        });
        expect(access.get("followed")).toEqual({
            audience: LibraryAudience.Follower,
            libraryVisibility: LibraryVisibility.Followers,
            canViewLibrary: true,
            visibleEntryLevels: [
                LibraryVisibility.Public,
                LibraryVisibility.Followers,
            ],
        });
        expect(access.get("not-followed")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Followers,
            canViewLibrary: false,
            visibleEntryLevels: [],
        });
        expect(access.get("public")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Public,
            canViewLibrary: true,
            visibleEntryLevels: [LibraryVisibility.Public],
        });
        expect(access.get("private")).toEqual({
            audience: LibraryAudience.Everyone,
            libraryVisibility: LibraryVisibility.Private,
            canViewLibrary: false,
            visibleEntryLevels: [],
        });
        expect(access.get("viewer")).toEqual({
            audience: LibraryAudience.Owner,
            libraryVisibility: LibraryVisibility.Private,
            canViewLibrary: true,
            visibleEntryLevels: ALL_LEVELS,
        });
    });

    it("skips the follow query when no non-owned profile is followers-only", async () => {
        const { service, userFollowRepository } = fixture();

        const access = await service.resolveMany("viewer", [
            profile("public", LibraryVisibility.Public),
            profile("private", LibraryVisibility.Private),
        ]);

        expect(userFollowRepository.find).not.toHaveBeenCalled();
        expect(access.get("public")?.canViewLibrary).toBe(true);
        expect(access.get("private")?.canViewLibrary).toBe(false);
    });
});
