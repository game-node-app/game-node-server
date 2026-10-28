import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { ApiProperty } from "@nestjs/swagger";

export class ImporterResponseItemDto extends GameExternalGame {
    /**
     * The preferred platform to use when adding this importer item to a user's collection.
     * @see CollectionsEntriesService#createOrUpdate
     */
    preferredPlatformId: number;

    @ApiProperty({ type: Boolean, required: true })
    isInLibrary?: boolean;
}
