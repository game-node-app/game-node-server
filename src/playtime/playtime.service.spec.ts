jest.mock("typeorm-transactional", () => ({
    Transactional:
        () =>
        (_target: object, _name: string, descriptor: PropertyDescriptor) =>
            descriptor,
}));

import { PlaytimeService } from "./playtime.service";
import { UserPlaytimeSource } from "./playtime.constants";
import { runPlayerSyncAttempt } from "../sync/player-sync-attempt";

const now = new Date("2026-10-25T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;

function observation(source = UserPlaytimeSource.PSN, recent?: number): any {
    return {
        profileUserId: "user",
        gameId: 1,
        source,
        platformId: 7,
        totalPlaytimeSeconds: 3600.4,
        recentPlaytimeSeconds: recent,
        lastPlayedDate: new Date("2026-10-01T10:20:30.789Z"),
        firstPlayedDate: undefined,
        totalPlayCount: undefined,
    };
}

function makeService(existing?: any) {
    const repository = {
        findOne: jest.fn().mockResolvedValue(existing ?? null),
        save: jest.fn(async (playtime) => ({
            ...playtime,
            totalPlaytimeSeconds: Math.round(
                playtime.totalPlaytimeSeconds ?? 0,
            ),
            recentPlaytimeSeconds: playtime.recentPlaytimeSeconds ?? 0,
            totalPlayCount: Math.round(playtime.totalPlayCount ?? 0),
            lastPlayedDate:
                playtime.lastPlayedDate == null
                    ? null
                    : new Date(
                          Math.floor(playtime.lastPlayedDate.getTime() / 1000) *
                              1000,
                      ),
            firstPlayedDate: playtime.firstPlayedDate ?? null,
            updatedAt: now,
        })),
    };
    const history = {
        save: jest.fn(),
        getTotalPlaytimeForPeriod: jest
            .fn()
            .mockResolvedValue([
                { gameId: 1, totalPlaytimeInPeriodSeconds: 42 },
            ]),
    };
    return {
        service: new PlaytimeService(repository as any, history as any),
        repository,
        history,
    };
}

describe("playtime provider checksums", () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(now));
    afterEach(() => jest.useRealTimers());

    it.each([0, 13, 14, 60])(
        "handles unchanged records aged %i days at the 14-day refresh boundary",
        async (ageInDays) => {
            const initial = makeService();
            const saved = await initial.service.save(observation());
            const existing = {
                ...saved,
                updatedAt: new Date(now.getTime() - ageInDays * day),
            };
            const current = makeService(existing);

            const result = await current.service.save(observation());

            if (ageInDays < 14) {
                expect(result).toBe(existing);
                expect(current.history.save).not.toHaveBeenCalled();
                expect(
                    current.history.getTotalPlaytimeForPeriod,
                ).toHaveBeenCalledTimes(1);
                expect(current.repository.save).not.toHaveBeenCalled();
            } else {
                expect(current.history.save).not.toHaveBeenCalled();
                expect(
                    current.history.getTotalPlaytimeForPeriod,
                ).toHaveBeenCalledTimes(1);
                expect(current.repository.save).toHaveBeenCalledTimes(1);
                expect(current.repository.save).toHaveBeenCalledWith(
                    expect.objectContaining({ recentPlaytimeSeconds: 42 }),
                );
            }
        },
    );

    it("treats values lost to database defaults and datetime precision as unchanged", async () => {
        const initial = makeService();
        const saved = await initial.service.save(observation());
        const existing = {
            ...saved,
            gameId: String(saved.gameId),
            platformId: String(saved.platformId),
            updatedAt: now,
        };
        const current = makeService(existing);
        const equivalent = {
            ...observation(),
            totalPlaytimeSeconds: 3600.3,
            lastPlayedDate: new Date("2026-10-01T10:20:30.000Z"),
            firstPlayedDate: null,
            totalPlayCount: 0,
        };

        await expect(current.service.save(equivalent)).resolves.toBe(existing);

        expect(current.history.save).not.toHaveBeenCalled();
        expect(current.repository.save).not.toHaveBeenCalled();
    });

    it("tracks Steam provider recent totals but excludes derived PSN recent totals", async () => {
        const initial = makeService();
        const saved = await initial.service.save(
            observation(UserPlaytimeSource.STEAM, 120),
        );
        const current = makeService({ ...saved, updatedAt: now });

        await current.service.save(observation(UserPlaytimeSource.STEAM, 180));

        expect(current.history.save).toHaveBeenCalledTimes(1);
        expect(
            current.history.getTotalPlaytimeForPeriod,
        ).not.toHaveBeenCalled();
    });

    it.each([UserPlaytimeSource.PSN, UserPlaytimeSource.XBOX])(
        "expires derived %s recent time even when the current row was just updated",
        async (source) => {
            const initial = makeService();
            const saved = await initial.service.save(observation(source));
            jest.setSystemTime(new Date(now.getTime() + 15 * day));
            const current = makeService({
                ...saved,
                updatedAt: new Date(now.getTime() + 14 * day),
            });
            current.history.getTotalPlaytimeForPeriod.mockResolvedValue([]);

            await current.service.save(observation(source));

            expect(current.history.save).not.toHaveBeenCalled();
            expect(current.repository.save).toHaveBeenCalledWith(
                expect.objectContaining({ recentPlaytimeSeconds: 0 }),
            );
            expect(
                current.history.getTotalPlaytimeForPeriod,
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    startDate: new Date(now.getTime() + day),
                    endDate: new Date(now.getTime() + 15 * day),
                }),
            );
        },
    );

    it("uses the attempt observation window independently of old played dates", async () => {
        const current = makeService();

        await runPlayerSyncAttempt(() => current.service.save(observation()));

        expect(current.history.save).toHaveBeenCalledWith(
            expect.objectContaining({
                lastPlayedDate: new Date("2026-10-01T10:20:30.789Z"),
            }),
            now,
        );
        expect(current.history.getTotalPlaytimeForPeriod).toHaveBeenCalledWith(
            expect.objectContaining({
                startDate: new Date("2026-10-11T12:00:00.000Z"),
                endDate: now,
            }),
        );
    });
});

test("import lookup chunks unique IDs and save uses the known rows without another read", async () => {
    const current = makeService();
    const findBy = jest.fn().mockResolvedValue([]);
    Object.assign(current.repository, { findBy });
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);
    const existing = await current.service.findForImport(
        "user",
        UserPlaytimeSource.STEAM,
        [...ids, 1],
    );
    expect(findBy).toHaveBeenCalledTimes(3);
    expect(
        findBy.mock.calls.map(([where]) => where.gameId.value.length),
    ).toEqual([500, 500, 1]);
    await current.service.saveImported(
        [observation(UserPlaytimeSource.STEAM, 120)],
        existing,
    );
    expect(current.repository.findOne).not.toHaveBeenCalled();
    expect(current.repository.save).toHaveBeenCalledTimes(1);
});

test("a multi-game import aggregates each derived window once after inserting all changed observations", async () => {
    const current = makeService();
    const playtimes = [1, 2, 3].map((gameId) => ({ ...observation(), gameId }));
    await current.service.saveImported(playtimes, new Map());
    expect(current.history.save).toHaveBeenCalledTimes(3);
    expect(current.history.getTotalPlaytimeForPeriod).toHaveBeenCalledTimes(1);
    expect(
        Math.max(...current.history.save.mock.invocationCallOrder),
    ).toBeLessThan(
        current.history.getTotalPlaytimeForPeriod.mock.invocationCallOrder[0],
    );
    expect(current.repository.save).toHaveBeenCalledTimes(3);
    expect(current.repository.findOne).not.toHaveBeenCalled();
});

test("identical manual retries preserve legacy counts and omitted provider dates", async () => {
    const existing = {
        ...observation(),
        totalPlayCount: 7,
        recentPlaytimeSeconds: 42,
        firstPlayedDate: new Date("2020-01-01T00:00:00Z"),
        updatedAt: now,
    };
    const current = makeService(existing);
    const saved = await current.service.submit("user", {
        gameId: existing.gameId,
        source: existing.source,
        platformId: existing.platformId,
        totalPlaytimeSeconds: existing.totalPlaytimeSeconds,
        lastPlayedDate: undefined,
    });
    expect(saved).toBe(existing);
    expect(current.history.save).not.toHaveBeenCalled();
    expect(current.repository.save).not.toHaveBeenCalled();
});
