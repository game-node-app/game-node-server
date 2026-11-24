import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { Collection } from "../collections/entities/collection.entity";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionsService } from "../collections/collections.service";
import { Profile } from "../profile/entities/profile.entity";
import { UserFollow } from "../follow/entity/user-follow.entity";
import { LibraryAccessService } from "../libraries/library-access.service";
import { LibraryVisibility } from "../libraries/library-visibility.constants";
import { JournalService } from "./journal.service";
import { JournalHeatmapService } from "./journal-heatmap.service";
import { JournalPlayLogService } from "./journal-play-log.service";
import { JournalOverviewResponseDto } from "./dto/get-journal-overview.dto";
import { JournalPlaylogItemType } from "./journal.constants";

const FIXTURE_YEAR = 2024;
const PUBLIC_GAME = 930001;
const FOLLOWERS_GAME = 930002;
const PRIVATE_GAME = 930003;

jest.setTimeout(120_000);

describe("Journal access (MySQL)", () => {
    let source: DataSource;
    let journal: JournalService;
    let heatmap: JournalHeatmapService;
    let playlog: JournalPlayLogService;
    let ownerId: string;
    let followerId: string;

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        const libraryAccess = new LibraryAccessService(
            source.getRepository(Profile),
            source.getRepository(UserFollow),
            source.getRepository(CollectionEntry),
        );
        const collections = new CollectionsService(
            source.getRepository(Collection),
            {} as any,
            undefined,
            libraryAccess,
        );
        const entries = new CollectionsEntriesService(
            source.getRepository(CollectionEntry),
            source.getRepository(CollectionEntryToCollection),
            {} as any,
            {} as any,
            {} as any,
            collections,
            {} as any,
            {} as any,
            undefined,
            libraryAccess,
        );
        journal = new JournalService(
            source.getRepository(CollectionEntry),
            libraryAccess,
            undefined,
        );
        heatmap = new JournalHeatmapService(journal);
        playlog = new JournalPlayLogService(
            entries,
            { findAllByGameId: async () => [] } as any,
            { findAllObtainedByGameId: async () => [] } as any,
            {} as any,
        );

        ownerId = randomUUID();
        followerId = randomUUID();
        await source.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
            [
                PUBLIC_GAME,
                "Journal public",
                "journal-public-fixture",
                FOLLOWERS_GAME,
                "Journal followers",
                "journal-followers-fixture",
                PRIVATE_GAME,
                "Journal private",
                "journal-private-fixture",
            ],
        );
        await source.query(
            "INSERT INTO profile (userId, username, libraryVisibility) VALUES (?, ?, 'public'), (?, ?, 'public')",
            [
                ownerId,
                `journal_${ownerId.slice(0, 8)}`,
                followerId,
                `journal_${followerId.slice(0, 8)}`,
            ],
        );
        await source.query("INSERT INTO library (userId) VALUES (?)", [
            ownerId,
        ]);
        await source.query(
            "INSERT INTO user_follow (followerUserId, followedUserId) VALUES (?, ?)",
            [followerId, ownerId],
        );

        const finishedAt = new Date(`${FIXTURE_YEAR}-03-01T12:00:00Z`);
        for (const [gameId, visibility] of [
            [PUBLIC_GAME, LibraryVisibility.Public],
            [FOLLOWERS_GAME, LibraryVisibility.Followers],
            [PRIVATE_GAME, LibraryVisibility.Private],
        ] as const) {
            await source.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, status, finishedAt, visibility) VALUES (?, ?, ?, 'finished', ?, ?)",
                [randomUUID(), gameId, ownerId, finishedAt, visibility],
            );
        }
    });

    afterAll(async () => {
        if (!source?.isInitialized) return;
        await source.query("DELETE FROM library WHERE userId = ?", [ownerId]);
        await source.query("DELETE FROM profile WHERE userId IN (?, ?)", [
            ownerId,
            followerId,
        ]);
        await source.query("DELETE FROM game WHERE id IN (?, ?, ?)", [
            PUBLIC_GAME,
            FOLLOWERS_GAME,
            PRIVATE_GAME,
        ]);
        await source.destroy();
    });

    const overviewGameIds = (overview: JournalOverviewResponseDto) =>
        overview.years
            .flatMap((year) => year.months)
            .flatMap((month) => month.days)
            .flatMap((day) => day.entries)
            .map((entry) => entry.gameId);

    it("shows a visitor only the public games in the overview and heatmap", async () => {
        const overview = await journal.getOverview(undefined, ownerId);
        expect(overviewGameIds(overview).toSorted()).toEqual([PUBLIC_GAME]);

        const visitorHeatmap = await heatmap.buildHeatmap(undefined, ownerId);
        expect(visitorHeatmap.items).toHaveLength(1);
        expect(visitorHeatmap.items[0].count).toBe(1);
    });

    it("shows a follower the followers-only game as well", async () => {
        const overview = await journal.getOverview(followerId, ownerId);
        expect(overviewGameIds(overview).toSorted()).toEqual([
            PUBLIC_GAME,
            FOLLOWERS_GAME,
        ]);
    });

    it("keeps the owner's overview and heatmap unchanged", async () => {
        const overview = await journal.getOverview(ownerId, ownerId);
        expect(overviewGameIds(overview).toSorted()).toEqual([
            PUBLIC_GAME,
            FOLLOWERS_GAME,
            PRIVATE_GAME,
        ]);

        const ownerHeatmap = await heatmap.buildHeatmap(ownerId, ownerId);
        expect(ownerHeatmap.items).toHaveLength(1);
        expect(ownerHeatmap.items[0].count).toBe(3);
    });

    it("filters the overview to a requested year", async () => {
        const matching = await journal.getOverview(
            undefined,
            ownerId,
            FIXTURE_YEAR,
        );
        expect(matching.years.map((year) => year.year)).toEqual([FIXTURE_YEAR]);
        expect(overviewGameIds(matching)).toEqual([PUBLIC_GAME]);

        const empty = await journal.getOverview(
            undefined,
            ownerId,
            FIXTURE_YEAR + 1,
        );
        expect(empty).toEqual({ years: [] });
    });

    it("returns 404 for the play log of a game hidden from the viewer", async () => {
        await expect(
            playlog.getPlaylog(ownerId, PRIVATE_GAME, undefined),
        ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
        await expect(
            playlog.getPlaylog(ownerId, FOLLOWERS_GAME, undefined),
        ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it("returns the play log of a visible game to a visitor and every game to the owner", async () => {
        const visitorLog = await playlog.getPlaylog(
            ownerId,
            PUBLIC_GAME,
            undefined,
        );
        expect(visitorLog).toHaveLength(1);
        expect(visitorLog[0].type).toBe(
            JournalPlaylogItemType.COLLECTION_ENTRY_STATUS,
        );
        expect(visitorLog[0].entries[0].gameId).toBe(PUBLIC_GAME);

        const ownerLog = await playlog.getPlaylog(
            ownerId,
            PRIVATE_GAME,
            ownerId,
        );
        expect(ownerLog[0].entries[0].gameId).toBe(PRIVATE_GAME);
    });
});
