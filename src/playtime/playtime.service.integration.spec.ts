import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { LibraryAccessService } from "../libraries/library-access.service";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeFiterPeriod, UserPlaytimeSource } from "./playtime.constants";

describe("PlaytimeService library visibility", () => {
    const publicOwner = randomUUID();
    const privateOwner = randomUUID();
    const follower = randomUUID();
    const gamePublic = 9_100_000_000_001;
    const gamePrivate = 9_100_000_000_002;
    const gameFollowers = 9_100_000_000_003;
    const gameWithoutEntry = 9_100_000_000_004;
    const gamePrivateLibrary = 9_100_000_000_005;
    const platformId = 9_100_000_000_010;

    let source: DataSource;
    let service: PlaytimeService;
    let access: LibraryAccessService;

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        access = new LibraryAccessService(
            source.getRepository(Profile),
            source.getRepository(UserFollow),
            source.getRepository(CollectionEntry),
        );
        service = new PlaytimeService(
            source.getRepository(UserPlaytime),
            {} as any,
        );

        await source.query(
            `INSERT INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
            [
                gamePublic,
                "Visibility public",
                "visibility-public-fixture",
                gamePrivate,
                "Visibility private",
                "visibility-private-fixture",
                gameFollowers,
                "Visibility followers",
                "visibility-followers-fixture",
                gameWithoutEntry,
                "Visibility no entry",
                "visibility-no-entry-fixture",
                gamePrivateLibrary,
                "Visibility private library",
                "visibility-private-library-fixture",
            ],
        );
        await source.query(
            "INSERT INTO game_platform (id, name, abbreviation, category) VALUES (?, ?, ?, 1)",
            [platformId, "Visibility platform", "VIS"],
        );

        for (const [index, ownerId] of [publicOwner, privateOwner].entries()) {
            await source.query(
                "INSERT INTO profile (userId, username, libraryVisibility) VALUES (?, ?, ?)",
                [
                    ownerId,
                    `ptv${index}${randomUUID().slice(0, 8)}`,
                    ownerId === privateOwner
                        ? LibraryVisibility.Private
                        : LibraryVisibility.Public,
                ],
            );
            await source.query("INSERT INTO library (userId) VALUES (?)", [
                ownerId,
            ]);
        }
        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [follower, `ptvf${randomUUID().slice(0, 8)}`],
        );
        await source.query(
            "INSERT INTO user_follow (followerUserId, followedUserId) VALUES (?, ?)",
            [follower, publicOwner],
        );

        for (const [gameId, visibility] of [
            [gamePublic, LibraryVisibility.Public],
            [gamePrivate, LibraryVisibility.Private],
            [gameFollowers, LibraryVisibility.Followers],
        ]) {
            await source.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, visibility) VALUES (?, ?, ?, ?)",
                [randomUUID(), gameId, publicOwner, visibility],
            );
        }
        await source.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, visibility) VALUES (?, ?, ?, ?)",
            [
                randomUUID(),
                gamePrivateLibrary,
                privateOwner,
                LibraryVisibility.Public,
            ],
        );

        for (const [index, [ownerId, gameId]] of [
            [publicOwner, gamePublic],
            [publicOwner, gamePrivate],
            [publicOwner, gameFollowers],
            [publicOwner, gameWithoutEntry],
            [privateOwner, gamePrivateLibrary],
        ].entries()) {
            await source.query(
                `INSERT INTO user_playtime
                    (source, profileUserId, gameId, totalPlaytimeSeconds, recentPlaytimeSeconds,
                     totalPlayCount, platformId, lastPlayedDate, checksum)
                 VALUES (?, ?, ?, ?, 0, 1, ?, ?, NULL)`,
                [
                    UserPlaytimeSource.STEAM,
                    ownerId,
                    gameId,
                    (index + 1) * 3600,
                    platformId,
                    `2025-01-0${index + 1} 00:00:00`,
                ],
            );
        }
    });

    afterAll(async () => {
        if (!source?.isInitialized) return;
        await source.query("DELETE FROM library WHERE userId IN (?, ?)", [
            publicOwner,
            privateOwner,
        ]);
        await source.query("DELETE FROM profile WHERE userId IN (?, ?, ?)", [
            publicOwner,
            privateOwner,
            follower,
        ]);
        await source.query("DELETE FROM game WHERE id IN (?, ?, ?, ?, ?)", [
            gamePublic,
            gamePrivate,
            gameFollowers,
            gameWithoutEntry,
            gamePrivateLibrary,
        ]);
        await source.query("DELETE FROM game_platform WHERE id = ?", [
            platformId,
        ]);
        await source.destroy();
    });

    const gameIds = (playtimes: { gameId: number }[]) =>
        playtimes.map((playtime) => playtime.gameId).sort((a, b) => a - b);

    it("hides a private entry's playtime from every public route shape", async () => {
        const viewer = await access.resolve(undefined, publicOwner);

        await expect(
            service.findAllByUserIdAndGameId(publicOwner, gamePrivate, viewer),
        ).resolves.toEqual([]);
        await expect(
            service.findAccumulatedForUserIdAndGameId(
                publicOwner,
                gamePrivate,
                viewer,
            ),
        ).resolves.toMatchObject({
            gameId: gamePrivate,
            totalPlaytimeSeconds: 0,
            totalPlayCount: 0,
        });

        const [list] = await service.findAllByUserId(
            publicOwner,
            undefined,
            viewer,
        );
        expect(gameIds(list)).toEqual([gamePublic, gameWithoutEntry]);

        const [filtered] = await service.findAllByUserIdWithFilters(
            publicOwner,
            { period: PlaytimeFiterPeriod.ALL },
            viewer,
        );
        expect(gameIds(filtered)).toEqual([gamePublic, gameWithoutEntry]);
    });

    it("sums only the visible games' playtime and returns zero for a hidden library", async () => {
        const visitor = await access.resolve(undefined, publicOwner);
        await expect(
            service.getTotalPlaytimeByUserId(
                publicOwner,
                "totalPlaytimeSeconds",
                undefined,
                undefined,
                visitor,
            ),
        ).resolves.toBe(18000);

        const followerViewer = await access.resolve(follower, publicOwner);
        await expect(
            service.getTotalPlaytimeByUserId(
                publicOwner,
                "totalPlaytimeSeconds",
                undefined,
                undefined,
                followerViewer,
            ),
        ).resolves.toBe(28800);

        const hiddenLibraryViewer = await access.resolve(
            undefined,
            privateOwner,
        );
        await expect(
            service.getTotalPlaytimeByUserId(
                privateOwner,
                "totalPlaytimeSeconds",
                undefined,
                undefined,
                hiddenLibraryViewer,
            ),
        ).resolves.toBe(0);

        const ownerViewer = await access.resolve(publicOwner, publicOwner);
        await expect(
            service.getTotalPlaytimeByUserId(
                publicOwner,
                "totalPlaytimeSeconds",
                undefined,
                undefined,
                ownerViewer,
            ),
        ).resolves.toBe(36000);
    });

    it("shows a follower the followers entry but not the private one", async () => {
        const viewer = await access.resolve(follower, publicOwner);

        const [list] = await service.findAllByUserId(
            publicOwner,
            undefined,
            viewer,
        );
        expect(gameIds(list)).toEqual([
            gamePublic,
            gameFollowers,
            gameWithoutEntry,
        ]);

        await expect(
            service.findAllByUserIdAndGameId(
                publicOwner,
                gameFollowers,
                viewer,
            ),
        ).resolves.toHaveLength(1);
    });

    it("returns empty results for a hidden library but keeps the owner's view", async () => {
        const viewer = await access.resolve(undefined, privateOwner);

        await expect(
            service.findAllByUserId(privateOwner, undefined, viewer),
        ).resolves.toEqual([[], 0]);
        await expect(
            service.findAllByUserIdWithFilters(
                privateOwner,
                {
                    period: PlaytimeFiterPeriod.ALL,
                },
                viewer,
            ),
        ).resolves.toEqual([[], 0]);
        await expect(
            service.findAllByUserIdAndGameId(
                privateOwner,
                gamePrivateLibrary,
                viewer,
            ),
        ).resolves.toEqual([]);
        await expect(
            service.findAccumulatedForUserIdAndGameId(
                privateOwner,
                gamePrivateLibrary,
                viewer,
            ),
        ).resolves.toMatchObject({
            totalPlaytimeSeconds: 0,
            totalPlayCount: 0,
        });

        const ownerView = await access.resolve(privateOwner, privateOwner);
        const [ownerList] = await service.findAllByUserId(
            privateOwner,
            undefined,
            ownerView,
        );
        expect(gameIds(ownerList)).toEqual([gamePrivateLibrary]);
    });

    it("keeps the unrestricted behavior for owner-only/internal callers", async () => {
        const [list] = await service.findAllByUserId(publicOwner);

        expect(gameIds(list)).toEqual([
            gamePublic,
            gamePrivate,
            gameFollowers,
            gameWithoutEntry,
        ]);
    });
});
