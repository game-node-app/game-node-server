import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import { Profile } from "../profile/entities/profile.entity";
import { GuildConsumableInventory } from "./entities/guild-consumable-inventory.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";
import { GuildConsumableKey, GuildSealReason } from "./guild.constants";
import { GuildSealsService } from "./guild-seals.service";

const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
        () => null,
        (error) => error,
    );

describe("GuildSealsService (integration)", () => {
    jest.setTimeout(120000);

    const database = `guild_test_seals_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>>;
    let source: DataSource;
    let service: GuildSealsService;

    beforeAll(async () => {
        db = await createAwardsTestDatabase(database);
        source = db.source;
        service = new GuildSealsService(source);
    });

    afterAll(async () => {
        await db?.destroy();
    });

    const createProfile = async () => {
        const userId = randomUUID();
        await source.getRepository(Profile).insert({
            userId,
            username: `g${userId.slice(0, 18)}`,
        });
        return userId;
    };

    const transaction = <T>(work: (manager: EntityManager) => Promise<T>) =>
        source.transaction(work);

    const balanceOf = (userId: string) =>
        source
            .getRepository(GuildProfile)
            .findOneBy({ profileUserId: userId })
            .then((profile) => profile?.sealsBalance ?? 0);

    const ledgerOf = (userId: string) =>
        source
            .getRepository(GuildSealLedger)
            .find({
                where: { profileUserId: userId },
                order: { id: "ASC" },
            })
            .then((rows) =>
                rows.map(({ delta, balanceAfter, reason, referenceId }) => ({
                    delta,
                    balanceAfter,
                    reason,
                    referenceId,
                })),
            );

    describe("Seals balance and ledger", () => {
        it("credits Seals and appends one immutable ledger row per movement", async () => {
            const userId = await createProfile();

            await expect(
                transaction((manager) =>
                    service.creditSealsWithManager(
                        manager,
                        userId,
                        40,
                        GuildSealReason.CONTRACT_CLAIM,
                        "contract-1",
                    ),
                ),
            ).resolves.toBe(40);
            await expect(
                transaction((manager) =>
                    service.creditSealsWithManager(
                        manager,
                        userId,
                        35,
                        GuildSealReason.BONUS_OBJECTIVE,
                    ),
                ),
            ).resolves.toBe(75);

            await expect(balanceOf(userId)).resolves.toBe(75);
            await expect(ledgerOf(userId)).resolves.toEqual([
                {
                    delta: 40,
                    balanceAfter: 40,
                    reason: GuildSealReason.CONTRACT_CLAIM,
                    referenceId: "contract-1",
                },
                {
                    delta: 35,
                    balanceAfter: 75,
                    reason: GuildSealReason.BONUS_OBJECTIVE,
                    referenceId: null,
                },
            ]);
        });

        it("debits Seals and rejects an insufficient balance without mutating it", async () => {
            const userId = await createProfile();
            await transaction((manager) =>
                service.creditSealsWithManager(
                    manager,
                    userId,
                    40,
                    GuildSealReason.CONTRACT_CLAIM,
                ),
            );

            await expect(
                transaction((manager) =>
                    service.debitSealsWithManager(
                        manager,
                        userId,
                        15,
                        GuildSealReason.EMPORIUM_PURCHASE,
                        "item-1",
                    ),
                ),
            ).resolves.toBe(25);

            const rejection = await rejectionOf(
                transaction((manager) =>
                    service.debitSealsWithManager(
                        manager,
                        userId,
                        30,
                        GuildSealReason.EMPORIUM_PURCHASE,
                    ),
                ),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_insufficient_seals",
            });

            await expect(balanceOf(userId)).resolves.toBe(25);
            const ledger = await ledgerOf(userId);
            expect(ledger.map(({ delta }) => delta)).toEqual([40, -15]);
            expect(ledger.at(-1)?.balanceAfter).toBe(25);
        });

        it("rolls the balance and ledger back with the caller's transaction", async () => {
            const userId = await createProfile();

            await expect(
                transaction(async (manager) => {
                    await service.creditSealsWithManager(
                        manager,
                        userId,
                        50,
                        GuildSealReason.CONTRACT_CLAIM,
                    );
                    throw new Error("rollback");
                }),
            ).rejects.toThrow("rollback");

            await expect(balanceOf(userId)).resolves.toBe(0);
            await expect(ledgerOf(userId)).resolves.toEqual([]);
        });

        it("keeps every recorded balanceAfter equal to the running sum of deltas", async () => {
            const userId = await createProfile();
            const movements: Array<[number, GuildSealReason]> = [
                [100, GuildSealReason.CONTRACT_CLAIM],
                [-35, GuildSealReason.EMPORIUM_PURCHASE],
                [25, GuildSealReason.DUPLICATE_FALLBACK],
                [-60, GuildSealReason.EMPORIUM_PURCHASE],
            ];

            for (const [amount, reason] of movements) {
                await transaction((manager) =>
                    amount > 0
                        ? service.creditSealsWithManager(
                              manager,
                              userId,
                              amount,
                              reason,
                          )
                        : service.debitSealsWithManager(
                              manager,
                              userId,
                              -amount,
                              reason,
                          ),
                );
            }

            const ledger = await ledgerOf(userId);
            let running = 0;
            for (const row of ledger) {
                running += row.delta;
                expect(row.balanceAfter).toBe(running);
            }
            await expect(balanceOf(userId)).resolves.toBe(running);
            await expect(balanceOf(userId)).resolves.toBe(30);
        });

        it("serializes concurrent debits so the balance never goes negative", async () => {
            const userId = await createProfile();
            await transaction((manager) =>
                service.creditSealsWithManager(
                    manager,
                    userId,
                    100,
                    GuildSealReason.CONTRACT_CLAIM,
                ),
            );

            const outcomes = await Promise.allSettled([
                transaction((manager) =>
                    service.debitSealsWithManager(
                        manager,
                        userId,
                        60,
                        GuildSealReason.EMPORIUM_PURCHASE,
                        "race-a",
                    ),
                ),
                transaction((manager) =>
                    service.debitSealsWithManager(
                        manager,
                        userId,
                        60,
                        GuildSealReason.EMPORIUM_PURCHASE,
                        "race-b",
                    ),
                ),
            ]);

            const fulfilled = outcomes.filter(
                (outcome) => outcome.status === "fulfilled",
            );
            const rejected = outcomes.filter(
                (outcome): outcome is PromiseRejectedResult =>
                    outcome.status === "rejected",
            );
            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason).toBeInstanceOf(ConflictException);
            expect(rejected[0].reason.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_insufficient_seals",
            });

            await expect(balanceOf(userId)).resolves.toBe(40);
            const ledger = await ledgerOf(userId);
            expect(ledger.map(({ delta }) => delta)).toEqual([100, -60]);
        });

        it("rejects non-positive movements before touching the balance", async () => {
            const userId = await createProfile();

            for (const work of [
                (manager: EntityManager) =>
                    service.creditSealsWithManager(
                        manager,
                        userId,
                        0,
                        GuildSealReason.CONTRACT_CLAIM,
                    ),
                (manager: EntityManager) =>
                    service.debitSealsWithManager(
                        manager,
                        userId,
                        -5,
                        GuildSealReason.EMPORIUM_PURCHASE,
                    ),
                (manager: EntityManager) =>
                    service.grantConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.HOURGLASS,
                        0,
                    ),
            ]) {
                const rejection = await rejectionOf(transaction(work));
                expect(rejection).toBeInstanceOf(BadRequestException);
            }

            await expect(balanceOf(userId)).resolves.toBe(0);
            await expect(ledgerOf(userId)).resolves.toEqual([]);
        });
    });

    describe("Consumable inventory", () => {
        it("grants, stacks and consumes consumables atomically", async () => {
            const userId = await createProfile();

            await expect(
                transaction((manager) =>
                    service.grantConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.HOURGLASS,
                        2,
                    ),
                ),
            ).resolves.toBe(2);
            await expect(
                transaction((manager) =>
                    service.grantConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.HOURGLASS,
                    ),
                ),
            ).resolves.toBe(3);
            await expect(
                transaction((manager) =>
                    service.consumeConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.HOURGLASS,
                        2,
                    ),
                ),
            ).resolves.toBe(1);

            await expect(
                service.getConsumableBalances(userId),
            ).resolves.toEqual({
                [GuildConsumableKey.HOURGLASS]: 1,
                [GuildConsumableKey.REROLL_CHARTER]: 0,
                [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 0,
            });
        });

        it("rejects consuming more than owned without changing the quantity", async () => {
            const userId = await createProfile();
            await transaction((manager) =>
                service.grantConsumableWithManager(
                    manager,
                    userId,
                    GuildConsumableKey.REROLL_CHARTER,
                    1,
                ),
            );

            const rejection = await rejectionOf(
                transaction((manager) =>
                    service.consumeConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.REROLL_CHARTER,
                        2,
                    ),
                ),
            );
            expect(rejection).toBeInstanceOf(ConflictException);
            expect(rejection.getStatus()).toBe(409);
            expect(rejection.getResponse()).toEqual({
                message: expect.any(String),
                code: "guild_consumable_not_owned",
            });

            await expect(
                source.getRepository(GuildConsumableInventory).findOneByOrFail({
                    profileUserId: userId,
                    consumableKey: GuildConsumableKey.REROLL_CHARTER,
                }),
            ).resolves.toEqual(
                expect.objectContaining({
                    quantity: 1,
                }),
            );
        });

        it("rolls consumable grants back with the caller's transaction", async () => {
            const userId = await createProfile();

            await expect(
                transaction(async (manager) => {
                    await service.grantConsumableWithManager(
                        manager,
                        userId,
                        GuildConsumableKey.EXTRA_SLOT_PERMIT,
                    );
                    throw new Error("rollback");
                }),
            ).rejects.toThrow("rollback");

            await expect(
                service.getConsumableBalances(userId),
            ).resolves.toEqual({
                [GuildConsumableKey.HOURGLASS]: 0,
                [GuildConsumableKey.REROLL_CHARTER]: 0,
                [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 0,
            });
        });
    });
});
