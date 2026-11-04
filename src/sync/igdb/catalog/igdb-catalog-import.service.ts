import { Injectable } from "@nestjs/common";
import { GameRepositoryCreateService } from "../../../game/game-repository/create/game-repository-create.service";
import { StatisticsSourceType } from "../../../statistics/statistics.constants";
import { ensureStatisticsTarget } from "../../../statistics/statistics-target.repository";
import { IGDBPartialGame } from "../../../game/game-repository/game-repository.types";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import {
    CatalogOwner,
    OwnershipAssertion,
    IgdbCatalogStateService,
} from "./igdb-catalog-state.service";

@Injectable()
export class IgdbCatalogImportService {
    constructor(
        private readonly games: GameRepositoryCreateService,
        private readonly state: IgdbCatalogStateService,
    ) {}
    async persist(
        game: IGDBPartialGame,
        owner: CatalogOwner | OwnershipAssertion,
        limiter: AsyncLeafLimiter,
        forceReconciliation: boolean,
    ) {
        await this.state.gameTransaction(owner, async (manager) => {
            await this.games.createOrUpdate(game, {
                manager,
                ownershipGuard: (transaction) =>
                    typeof owner === "function"
                        ? owner(transaction)
                        : this.state.assertOwnership(transaction, owner),
                limiter,
                forceReconciliation,
                reconcileRelations: true,
                ensureStatistics: async (manager, gameId) => {
                    await ensureStatisticsTarget(
                        manager,
                        StatisticsSourceType.GAME,
                        gameId,
                    );
                },
            });
        });
    }
}
