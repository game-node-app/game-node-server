import { EConnectionType } from "../../connection/connections.constants";
import { EGameExternalGameCategory } from "../game-repository/game-repository.constants";

export const GAME_ACHIEVEMENT_ENABLED_SOURCES = [
    EGameExternalGameCategory.Steam,
    EGameExternalGameCategory.PlaystationStoreUs,
    EGameExternalGameCategory.Microsoft,
    EGameExternalGameCategory.XboxGamePassUltimateCloud,
];

export const ACHIEVEMENT_CONNECTION_SOURCE = new Map([
    [EGameExternalGameCategory.Steam, EConnectionType.STEAM],
    [EGameExternalGameCategory.PlaystationStoreUs, EConnectionType.PSN],
    [EGameExternalGameCategory.Microsoft, EConnectionType.XBOX],
    [EGameExternalGameCategory.XboxMarketplace, EConnectionType.XBOX],
    [EGameExternalGameCategory.XboxGamePassUltimateCloud, EConnectionType.XBOX],
]);
