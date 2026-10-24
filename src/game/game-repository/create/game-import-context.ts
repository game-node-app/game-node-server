import { EntityManager } from "typeorm";
import { AsyncLeafLimiter } from "../../../sync/igdb/catalog/async-leaf-limiter";

export interface GameImportContext {
    manager: EntityManager;
    ownershipGuard(manager: EntityManager): Promise<unknown>;
    limiter: AsyncLeafLimiter;
    forceReconciliation: boolean;
    ensureStatistics(manager: EntityManager, gameId: number): Promise<void>;
}

export class InvalidGameEntryError extends Error {
    readonly code = "IGDB_INVALID_GAME";
    constructor(readonly gameId?: number) {
        super("IGDB game requires a positive integer ID and a usable name");
    }
}
