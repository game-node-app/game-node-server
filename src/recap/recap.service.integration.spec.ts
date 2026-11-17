import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { YearRecap } from "./entity/year-recap.entity";
import { RecapService } from "./recap.service";

describe("RecapService library visibility", () => {
    const publicOwner = randomUUID();
    const privateOwner = randomUUID();
    const publicGame = 9_200_000_000_001;
    const privateGame = 9_200_000_000_002;
    const privateLibraryGame = 9_200_000_000_003;
    const platformId = 9_200_000_000_010;
    const year = 2025;

    let source: DataSource;
    let service: RecapService;
    let profileRepository: Repository<Profile>;

    const addProfile = async (
        userId: string,
        libraryVisibility: LibraryVisibility,
    ) => {
        await source.query(
            "INSERT INTO profile (userId, username, libraryVisibility, createdAt, updatedAt) VALUES (?, ?, ?, '2020-01-01 00:00:00', '2020-01-01 00:00:00')",
            [userId, `rcv${randomUUID().slice(0, 8)}`, libraryVisibility],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [userId]);
    };

    const addEntry = async (
        userId: string,
        gameId: number,
        visibility: LibraryVisibility,
    ) =>
        source.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, visibility) VALUES (?, ?, ?, ?)",
            [randomUUID(), gameId, userId, visibility],
        );

    const addRecap = async (userId: string, gameIds: number[]) => {
        const inserted = await source.query(
            `INSERT INTO year_recap
                (year, profileUserId, totalPlayedGames, totalPlaytimeSeconds, totalAddedGames,
                 totalFinishedGames, totalDroppedGames, isFinal, totalReviewsCreated,
                 totalCollectionsCreated, totalFollowersGained, totalLikesPerformed)
             VALUES (?, ?, ?, ?, 0, 0, 0, 1, 0, 0, 0, 0)`,
            [year, userId, gameIds.length, gameIds.length * 3600],
        );
        for (const gameId of gameIds) {
            await source.query(
                `INSERT INTO year_recap_played_game
                    (recapId, gameId, platformId, totalPlaytimeSeconds, percentOfTotalPlaytime,
                     percentOfTotalPlaytimeFormatted)
                 VALUES (?, ?, ?, 3600, ?, '50.00')`,
                [inserted.insertId, gameId, platformId, 1 / gameIds.length],
            );
        }
    };

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        profileRepository = source.getRepository(Profile);
        service = new RecapService(
            source.getRepository(YearRecap),
            {
                findOneByIdOrFail: (userId: string) =>
                    profileRepository.findOneByOrFail({ userId }),
            } as any,
            { getRecapPhase: async () => "live" } as any,
            new LibraryAccessService(
                profileRepository,
                source.getRepository(UserFollow),
                source.getRepository(CollectionEntry),
            ),
        );

        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
            [
                publicGame,
                "Recap public",
                "recap-public-fixture",
                privateGame,
                "Recap private",
                "recap-private-fixture",
                privateLibraryGame,
                "Recap private library",
                "recap-private-library-fixture",
            ],
        );
        await source.query(
            "INSERT INTO game_platform (id, name, abbreviation, category) VALUES (?, ?, ?, 1)",
            [platformId, "Recap platform", "RCP"],
        );

        await addProfile(publicOwner, LibraryVisibility.Public);
        await addEntry(publicOwner, publicGame, LibraryVisibility.Public);
        await addEntry(publicOwner, privateGame, LibraryVisibility.Private);
        await addRecap(publicOwner, [publicGame, privateGame]);

        await addProfile(privateOwner, LibraryVisibility.Private);
        await addEntry(
            privateOwner,
            privateLibraryGame,
            LibraryVisibility.Public,
        );
        await addRecap(privateOwner, [privateLibraryGame]);
    });

    afterAll(async () => {
        if (!source?.isInitialized) return;
        await source.query("DELETE FROM library WHERE userId IN (?, ?)", [
            publicOwner,
            privateOwner,
        ]);
        await source.query("DELETE FROM profile WHERE userId IN (?, ?)", [
            publicOwner,
            privateOwner,
        ]);
        await source.query("DELETE FROM game WHERE id IN (?, ?, ?)", [
            publicGame,
            privateGame,
            privateLibraryGame,
        ]);
        await source.query("DELETE FROM game_platform WHERE id = ?", [
            platformId,
        ]);
        await source.destroy();
    });

    it("omits a hidden game from the played games and derived lists", async () => {
        const recap = await service.getRecapByUserId(publicOwner, year);

        expect(recap.playedGames.map((game) => game.gameId)).toEqual([
            publicGame,
        ]);
        expect(recap.topGames.map((game) => game.gameId)).toEqual([publicGame]);
        expect(recap.playtimeByPlatform).toEqual([
            { platform: platformId, totalPlaytimeSeconds: 3600, share: 1 },
        ]);
    });

    it("returns 404 for the recap and its status when the library is hidden", async () => {
        await expect(
            service.getRecapByUserId(privateOwner, year),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
            service.getRecapStatus(privateOwner, year),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the full recap and status to the owner of a private library", async () => {
        const recap = await service.getRecapByUserId(
            privateOwner,
            year,
            privateOwner,
        );
        expect(recap.playedGames.map((game) => game.gameId)).toEqual([
            privateLibraryGame,
        ]);

        await expect(
            service.getRecapStatus(privateOwner, year, privateOwner),
        ).resolves.toMatchObject({ isRecapCreated: true, phase: "live" });
    });
});
