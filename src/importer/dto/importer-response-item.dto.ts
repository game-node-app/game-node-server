import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";

export class ImporterResponseItemDto extends GameExternalGame {
    /**
     * The preferred platform to use when adding this importer item to a user's collection.
     * @see CollectionsEntriesService#createOrUpdate
     */
    preferredPlatformId: number;
}
