import { DataSource, Repository } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { LibraryAccessService } from "./library-access.service";
import {
    entryVisibilitySql,
    isEntryVisible,
    LIBRARY_VISIBILITY_LEVELS,
    LibraryAudience,
    LibraryVisibility,
} from "./library-visibility.constants";

type Viewer = {
    audience: LibraryAudience;
    userId: string | undefined;
};

describe("LibraryAccessService", () => {
    let source: DataSource;
    let service: LibraryAccessService;
    let profileRepository: Repository<Profile>;
    let userFollowRepository: Repository<UserFollow>;

    const owners = LIBRARY_VISIBILITY_LEVELS.map((libraryVisibility) => ({
        libraryVisibility,
        userId: randomUUID(),
        entries: LIBRARY_VISIBILITY_LEVELS.map((visibility) => ({
            id: randomUUID(),
            visibility,
        })),
    }));
    const follower = randomUUID();
    const nonFollower = randomUUID();
    const viewers: Viewer[] = [
        { audience: LibraryAudience.Follower, userId: follower },
        { audience: LibraryAudience.Everyone, userId: nonFollower },
        { audience: LibraryAudience.Everyone, userId: undefined },
    ];

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        profileRepository = source.getRepository(Profile);
        userFollowRepository = source.getRepository(UserFollow);
        service = new LibraryAccessService(
            profileRepository,
            userFollowRepository,
            source.getRepository(CollectionEntry),
        );

        for (const [index, owner] of owners.entries()) {
            await source.query(
                "INSERT INTO `profile` (`userId`, `username`, `libraryVisibility`) VALUES (?, ?, ?)",
                [
                    owner.userId,
                    `lv${index}${randomUUID().slice(0, 8)}`,
                    owner.libraryVisibility,
                ],
            );
            await source.query("INSERT INTO `library` (`userId`) VALUES (?)", [
                owner.userId,
            ]);
            for (const entry of owner.entries) {
                await source.query(
                    "INSERT INTO `collection_entry` (`id`, `gameId`, `libraryUserId`, `visibility`) VALUES (?, 1, ?, ?)",
                    [entry.id, owner.userId, entry.visibility],
                );
            }
        }

        for (const [index, userId] of [follower, nonFollower].entries()) {
            await source.query(
                "INSERT INTO `profile` (`userId`, `username`) VALUES (?, ?)",
                [userId, `lvv${index}${randomUUID().slice(0, 8)}`],
            );
        }

        // The follower follows every owner, so the follower audience is relative to each owner.
        for (const owner of owners) {
            await source.query(
                "INSERT INTO `user_follow` (`followerUserId`, `followedUserId`) VALUES (?, ?)",
                [follower, owner.userId],
            );
        }
    });

    afterAll(async () => {
        if (source?.isInitialized) {
            const ownerIds = owners.map((owner) => owner.userId);
            const userIds = [...ownerIds, follower, nonFollower];
            await source.query(
                `DELETE FROM \`library\` WHERE \`userId\` IN (${ownerIds.map(() => "?").join(", ")})`,
                ownerIds,
            );
            await source.query(
                `DELETE FROM \`profile\` WHERE \`userId\` IN (${userIds.map(() => "?").join(", ")})`,
                userIds,
            );
            await source.destroy();
        }
    });

    async function sqlVisibility(
        entryId: string,
        viewerId: string | undefined,
    ) {
        const row = await source
            .getRepository(CollectionEntry)
            .createQueryBuilder("ce")
            .select(entryVisibilitySql("ce"), "visible")
            .where("ce.id = :entryId", { entryId })
            .setParameter("viewerId", viewerId ?? null)
            .getRawOne();
        return Boolean(Number(row.visible));
    }

    it("agrees with the TypeScript rule for every profile level, entry level and audience", async () => {
        for (const owner of owners) {
            for (const entry of owner.entries) {
                const audiences = [
                    { audience: LibraryAudience.Owner, userId: owner.userId },
                    ...viewers,
                ];
                for (const viewer of audiences) {
                    const actual = await sqlVisibility(entry.id, viewer.userId);
                    const expected = isEntryVisible(
                        viewer.audience,
                        owner.libraryVisibility,
                        entry.visibility,
                    );
                    expect({
                        libraryVisibility: owner.libraryVisibility,
                        entryVisibility: entry.visibility,
                        audience: viewer.audience,
                        visible: actual,
                    }).toEqual({
                        libraryVisibility: owner.libraryVisibility,
                        entryVisibility: entry.visibility,
                        audience: viewer.audience,
                        visible: expected,
                    });
                }
            }
        }
    });

    it("changes the resolved audience on the next call after a follow and an unfollow", async () => {
        const owner = {
            userId: randomUUID(),
            libraryVisibility: LibraryVisibility.Followers,
        };
        const viewerId = randomUUID();
        await source.query(
            "INSERT INTO `profile` (`userId`, `username`, `libraryVisibility`) VALUES (?, ?, ?)",
            [
                owner.userId,
                `lvfollow${randomUUID().slice(0, 8)}`,
                owner.libraryVisibility,
            ],
        );
        await source.query(
            "INSERT INTO `profile` (`userId`, `username`) VALUES (?, ?)",
            [viewerId, `lvvfollow${randomUUID().slice(0, 8)}`],
        );

        try {
            await expect(
                service.resolve(viewerId, owner.userId),
            ).resolves.toEqual({
                audience: LibraryAudience.Everyone,
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: false,
                visibleEntryLevels: [],
            });

            await source.query(
                "INSERT INTO `user_follow` (`followerUserId`, `followedUserId`) VALUES (?, ?)",
                [viewerId, owner.userId],
            );
            await expect(
                service.resolve(viewerId, owner.userId),
            ).resolves.toEqual({
                audience: LibraryAudience.Follower,
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: true,
                visibleEntryLevels: [
                    LibraryVisibility.Public,
                    LibraryVisibility.Followers,
                ],
            });

            await source.query(
                "DELETE FROM `user_follow` WHERE `followerUserId` = ? AND `followedUserId` = ?",
                [viewerId, owner.userId],
            );
            await expect(
                service.resolve(viewerId, owner.userId),
            ).resolves.toEqual({
                audience: LibraryAudience.Everyone,
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: false,
                visibleEntryLevels: [],
            });

            await expect(
                service.resolve(owner.userId, owner.userId),
            ).resolves.toEqual({
                audience: LibraryAudience.Owner,
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: true,
                visibleEntryLevels: [
                    LibraryVisibility.Public,
                    LibraryVisibility.Followers,
                    LibraryVisibility.Private,
                ],
            });
            await expect(
                service.resolve(undefined, owner.userId),
            ).resolves.toEqual({
                audience: LibraryAudience.Everyone,
                libraryVisibility: LibraryVisibility.Followers,
                canViewLibrary: false,
                visibleEntryLevels: [],
            });
        } finally {
            await source.query("DELETE FROM `library` WHERE `userId` = ?", [
                owner.userId,
            ]);
            await source.query(
                "DELETE FROM `profile` WHERE `userId` IN (?, ?)",
                [owner.userId, viewerId],
            );
        }
    });

    it("lists the owner's hidden game ids sorted for the viewer's levels", async () => {
        const ownerId = randomUUID();
        await source.query(
            "INSERT INTO `profile` (`userId`, `username`) VALUES (?, ?)",
            [ownerId, `lvh${randomUUID().slice(0, 8)}`],
        );
        await source.query("INSERT INTO `library` (`userId`) VALUES (?)", [
            ownerId,
        ]);
        await source.query(
            "INSERT IGNORE INTO `game` (`id`, `name`, `slug`) VALUES (930000000010, 'lv10', 'lv-10'), (930000000020, 'lv20', 'lv-20'), (930000000030, 'lv30', 'lv-30')",
        );
        for (const [gameId, visibility] of [
            [930000000030, LibraryVisibility.Public],
            [930000000010, LibraryVisibility.Followers],
            [930000000020, LibraryVisibility.Private],
        ]) {
            await source.query(
                "INSERT INTO `collection_entry` (`id`, `gameId`, `libraryUserId`, `visibility`) VALUES (?, ?, ?, ?)",
                [randomUUID(), gameId, ownerId, visibility],
            );
        }

        try {
            await expect(
                service.hiddenGameIds(ownerId, [LibraryVisibility.Public]),
            ).resolves.toEqual([930000000010, 930000000020]);
            await expect(
                service.hiddenGameIds(ownerId, [
                    LibraryVisibility.Public,
                    LibraryVisibility.Followers,
                ]),
            ).resolves.toEqual([930000000020]);
            await expect(
                service.hiddenGameIds(ownerId, [...LIBRARY_VISIBILITY_LEVELS]),
            ).resolves.toEqual([]);
            await expect(service.hiddenGameIds(ownerId, [])).resolves.toEqual([
                930000000010, 930000000020, 930000000030,
            ]);
        } finally {
            await source.query("DELETE FROM `library` WHERE `userId` = ?", [
                ownerId,
            ]);
            await source.query("DELETE FROM `profile` WHERE `userId` = ?", [
                ownerId,
            ]);
            await source.query(
                "DELETE FROM `game` WHERE `id` IN (930000000010, 930000000020, 930000000030)",
            );
        }
    });
});
