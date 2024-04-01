import { OmitType } from "@nestjs/swagger";
import { GameExternalGame } from "../entities/game-external-game.entity";

/**
 * DTO representing a (external) game available in another service
 */
export class GameExternalStoreDto extends OmitType(GameExternalGame, ["game"]) {
    /**
     * Icon representing said store/service.
     */
    icon: string | null;
    storeName: string | null;
}
