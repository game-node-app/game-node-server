import { GamePlatform } from "../entities/game-platform.entity";

export class GamePlatformDto extends GamePlatform {
    /**
     * Icon name for the platform
     * Only available if {@link getIconNameForPlatformAbbreviation} or {@link getIconNamesForPlatformAbbreviations} was used to set it
     */
    iconName?: string;
}
