import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { Profile } from "../../profile/entities/profile.entity";
import { ExternalGameService } from "./external-game.service";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { UnmappedExternalGameOwner } from "./entity/unmapped-external-game-owner.entity";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";

const mysqlDescribe = process.env.IGDB_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("unmapped external games", () => {
    const Steam = EGameExternalGameCategory.Steam;
    let source: DataSource;
    let service: ExternalGameService;
    const users: string[] = [];
    // Unique source IDs per run keep the shared test database free of cross-run state.
    const run = randomUUID().slice(0, 8);
    const uid = (name: string) => `${run}-${name}`;

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
        service = new ExternalGameService(
            source.getRepository(GameExternalGame),
            source.getRepository(UnmappedExternalGame),
        );
    }, 120000);
    afterAll(async () => {
        for (const userId of users)
            await source.getRepository(Profile).delete({ userId });
        await source
            .getRepository(UnmappedExternalGame)
            .createQueryBuilder()
            .delete()
            .where("sourceUid LIKE :run", { run: `${run}-%` })
            .execute();
        await source?.destroy();
    });

    async function user() {
        const userId = randomUUID();
        users.push(userId);
        await source
            .getRepository(Profile)
            .insert({ userId, username: `um_${userId.slice(0, 12)}` });
        return userId;
    }
    const entry = (sourceUid: string, category = Steam) =>
        source
            .getRepository(UnmappedExternalGame)
            .findOneByOrFail({ sourceUid, category });
    const owners = (id: number) =>
        source
            .getRepository(UnmappedExternalGameOwner)
            .countBy({ unmappedExternalGameId: id });

    test("stores a new entry with its name, replaces the name and keeps it without one", async () => {
        const a = uid("name");
        await service.registerUnmappedGames(Steam, [
            { sourceUid: a, name: "Hollow Knight" },
        ]);
        expect(await entry(a)).toMatchObject({
            name: "Hollow Knight",
            isActive: true,
        });
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }]);
        expect((await entry(a)).name).toBe("Hollow Knight");
        await service.registerUnmappedGames(Steam, [
            { sourceUid: a, name: "Hollow Knight: Silksong" },
        ]);
        expect((await entry(a)).name).toBe("Hollow Knight: Silksong");
    });

    test("truncates long names and registers more than one chunk", async () => {
        const entries = Array.from({ length: 501 }, (_, index) => ({
            sourceUid: uid(`bulk-${index}`),
            name: index === 0 ? "x".repeat(300) : undefined,
        }));
        await service.registerUnmappedGames(Steam, entries);
        expect((await entry(entries[0].sourceUid)).name).toHaveLength(255);
        expect(await entry(entries[500].sourceUid)).toBeTruthy();
    });

    test("an inactive entry stays inactive when registered again", async () => {
        const a = uid("inactive");
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }]);
        await source
            .getRepository(UnmappedExternalGame)
            .update({ sourceUid: a, category: Steam }, { isActive: false });
        await service.registerUnmappedGames(
            Steam,
            [{ sourceUid: a }],
            await user(),
        );
        expect((await entry(a)).isActive).toBe(false);
    });

    test("counts a user once, counts each user, and drops owners with the profile", async () => {
        const a = uid("owners");
        const [first, second] = [await user(), await user()];
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }], first);
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }], first);
        const { id } = await entry(a);
        expect(await owners(id)).toBe(1);
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }], second);
        expect(await owners(id)).toBe(2);
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }]);
        expect(await owners(id)).toBe(2);
        await source.getRepository(Profile).delete({ userId: first });
        expect(await owners(id)).toBe(1);
    });

    test("lists active entries most-owned first and filters by category", async () => {
        // A category no sync registers, so rows from other specs cannot interleave.
        const category = EGameExternalGameCategory.Oculus;
        const [first, second, third] = [
            await user(),
            await user(),
            await user(),
        ];
        const [few, many, none, dismissed] = [
            "few",
            "many",
            "none",
            "gone",
        ].map(uid);
        await service.registerUnmappedGames(
            category,
            [{ sourceUid: few, name: "Few" }],
            first,
        );
        await service.registerUnmappedGames(
            category,
            [{ sourceUid: many, name: "Many" }, { sourceUid: dismissed }],
            first,
        );
        await service.registerUnmappedGames(
            category,
            [{ sourceUid: many }],
            second,
        );
        await service.registerUnmappedGames(
            category,
            [{ sourceUid: many }],
            third,
        );
        await service.registerUnmappedGames(category, [{ sourceUid: none }]);
        await service.registerUnmappedGames(Steam, [
            { sourceUid: uid("other-category") },
        ]);
        await service.dismissUnmappedGame(
            (await entry(dismissed, category)).id,
        );

        const [rows, total] = await service.getUnmappedGames({
            category,
            limit: 100,
        });
        const mine = rows.filter((row) => row.sourceUid.startsWith(`${run}-`));
        expect(
            mine.map((row) => [row.sourceUid, row.name, row.ownerCount]),
        ).toEqual([
            [many, "Many", 3],
            [few, "Few", 1],
            [none, null, 0],
        ]);
        expect(rows.every((row) => row.category === category)).toBe(true);
        expect(total).toBe(rows.length);

        const [page] = await service.getUnmappedGames({
            category,
            limit: 1,
            offset: 1,
        });
        expect(page).toHaveLength(1);
        expect(page[0].id).toBe(rows[1].id);
    });

    test("dismissing keeps an entry inactive across registrations and rejects unknown or inactive ids", async () => {
        const a = uid("dismiss");
        await service.registerUnmappedGames(Steam, [{ sourceUid: a }]);
        const { id } = await entry(a);
        await service.dismissUnmappedGame(id);
        await service.registerUnmappedGames(
            Steam,
            [{ sourceUid: a, name: "Soundtrack" }],
            await user(),
        );
        expect(await entry(a)).toMatchObject({
            isActive: false,
            name: "Soundtrack",
        });
        await expect(service.dismissUnmappedGame(id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(
            service.dismissUnmappedGame(2_000_000_000),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
