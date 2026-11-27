import {
    BadRequestException,
    ConflictException,
    Injectable,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { GuildConsumableKey, GuildSealReason } from "./guild.constants";
import { GuildConsumableInventory } from "./entities/guild-consumable-inventory.entity";
import { GuildSealLedger } from "./entities/guild-seal-ledger.entity";

export type GuildConsumableBalances = Record<GuildConsumableKey, number>;

const emptyConsumableBalances = (): GuildConsumableBalances => ({
    [GuildConsumableKey.HOURGLASS]: 0,
    [GuildConsumableKey.REROLL_CHARTER]: 0,
    [GuildConsumableKey.EXTRA_SLOT_PERMIT]: 0,
});

/**
 * Guild Seals balance + append-only ledger and consumable inventory (design 6).
 * Every mutation locks `guild_profile` FOR UPDATE first, so concurrent claims,
 * purchases and prestige grants serialize on the same row.
 */
@Injectable()
export class GuildSealsService {
    constructor(private readonly dataSource: DataSource) {}

    async creditSealsWithManager(
        manager: EntityManager,
        userId: string,
        amount: number,
        reason: GuildSealReason,
        referenceId?: string | null,
    ): Promise<number> {
        this.assertPositive(amount, "amount");
        const balance = await this.lockSealsBalance(manager, userId);
        return this.applySealsDelta(
            manager,
            userId,
            balance,
            amount,
            reason,
            referenceId,
        );
    }

    async debitSealsWithManager(
        manager: EntityManager,
        userId: string,
        amount: number,
        reason: GuildSealReason,
        referenceId?: string | null,
    ): Promise<number> {
        this.assertPositive(amount, "amount");
        const balance = await this.lockSealsBalance(manager, userId);
        if (balance < amount) {
            throw new ConflictException({
                message: "Not enough Guild Seals.",
                code: "guild_insufficient_seals",
            });
        }
        return this.applySealsDelta(
            manager,
            userId,
            balance,
            -amount,
            reason,
            referenceId,
        );
    }

    async grantConsumableWithManager(
        manager: EntityManager,
        userId: string,
        consumableKey: GuildConsumableKey,
        quantity = 1,
    ): Promise<number> {
        this.assertPositive(quantity, "quantity");
        await this.lockProfile(manager, userId);
        await manager.query(
            `INSERT INTO guild_consumable_inventory (profileUserId, consumableKey, quantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
            [userId, consumableKey, quantity, quantity],
        );
        return this.readConsumableQuantity(manager, userId, consumableKey);
    }

    async consumeConsumableWithManager(
        manager: EntityManager,
        userId: string,
        consumableKey: GuildConsumableKey,
        quantity = 1,
    ): Promise<number> {
        this.assertPositive(quantity, "quantity");
        await this.lockProfile(manager, userId);
        const result = await manager.query(
            `UPDATE guild_consumable_inventory
             SET quantity = quantity - ?
             WHERE profileUserId = ? AND consumableKey = ? AND quantity >= ?`,
            [quantity, userId, consumableKey, quantity],
        );
        if (result.affectedRows !== 1) {
            throw new ConflictException({
                message: "You do not own this Guild consumable.",
                code: "guild_consumable_not_owned",
            });
        }
        return this.readConsumableQuantity(manager, userId, consumableKey);
    }

    async getConsumableBalances(
        userId: string,
        manager?: EntityManager,
    ): Promise<GuildConsumableBalances> {
        const rows = await (manager ?? this.dataSource.manager)
            .getRepository(GuildConsumableInventory)
            .find({ where: { profileUserId: userId } });
        const balances = emptyConsumableBalances();
        for (const row of rows) {
            balances[row.consumableKey] = row.quantity;
        }
        return balances;
    }

    private async lockSealsBalance(
        manager: EntityManager,
        userId: string,
    ): Promise<number> {
        await this.lockProfile(manager, userId);
        const [row] = await manager.query(
            "SELECT sealsBalance FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        return Number(row.sealsBalance);
    }

    /** Race-safe lazy membership, then the design-6 `guild_profile` row lock. */
    private async lockProfile(manager: EntityManager, userId: string) {
        const [locked] = await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
        if (locked) return;
        await manager.query(
            "INSERT IGNORE INTO guild_profile (profileUserId) VALUES (?)",
            [userId],
        );
        await manager.query(
            "SELECT profileUserId FROM guild_profile WHERE profileUserId = ? FOR UPDATE",
            [userId],
        );
    }

    private async applySealsDelta(
        manager: EntityManager,
        userId: string,
        balanceBefore: number,
        delta: number,
        reason: GuildSealReason,
        referenceId?: string | null,
    ): Promise<number> {
        const balanceAfter = balanceBefore + delta;
        await manager.query(
            "UPDATE guild_profile SET sealsBalance = ? WHERE profileUserId = ?",
            [balanceAfter, userId],
        );
        await manager.getRepository(GuildSealLedger).insert({
            profileUserId: userId,
            delta,
            balanceAfter,
            reason,
            referenceId: referenceId?.slice(0, 64) ?? null,
        });
        return balanceAfter;
    }

    private async readConsumableQuantity(
        manager: EntityManager,
        userId: string,
        consumableKey: GuildConsumableKey,
    ): Promise<number> {
        const [row] = await manager.query(
            "SELECT quantity FROM guild_consumable_inventory WHERE profileUserId = ? AND consumableKey = ?",
            [userId, consumableKey],
        );
        return Number(row?.quantity ?? 0);
    }

    private assertPositive(value: number, name: string) {
        if (!Number.isInteger(value) || value <= 0) {
            throw new BadRequestException({
                message: `Guild ${name} must be a positive integer.`,
                code: "guild_invalid_amount",
            });
        }
    }
}
