import dayjs from "dayjs";
import { YearRecapDto } from "./dto/year-recap.dto";
import { getIconNameForPlatformAbbreviation } from "../game/game-repository/game-repository.utils";

export function getTargetRecapYear() {
    const now = dayjs();
    if (now.month() === 11) {
        return now.year();
    }

    return now.year() - 1;
}

/**
 * Updates game platforms within a recap entity in-place to include their icon names.
 * @param entity
 */
export function transformRecapPlatforms(entity: Partial<YearRecapDto>) {
    if (entity.playedGames) {
        entity.playedGames.forEach((pg) => {
            if (pg.platform == undefined) return;

            pg.platform = {
                ...pg.platform,
                iconName: getIconNameForPlatformAbbreviation(
                    pg.platform.abbreviation,
                ),
            };
        });
    }
}

export function transformRecapDistributions(entity: Partial<YearRecapDto>) {
    if (entity.genres) {
        entity.distributionByGenre = entity.genres.map((genre) => {
            return {
                criteriaId: genre.genre.id,
                criteriaName: genre.genre.name!,
                count: genre.totalGames,
                finishedCount: genre.totalGamesFinished,
            };
        });
    }
    if (entity.themes) {
        entity.distributionByTheme = entity.themes.map((theme) => {
            return {
                criteriaId: theme.theme.id,
                criteriaName: theme.theme.name!,
                count: theme.totalGames,
                finishedCount: theme.totalGamesFinished,
            };
        });
    }
    if (entity.modes) {
        entity.distributionByMode = entity.modes.map((mode) => {
            return {
                criteriaId: mode.mode.id,
                criteriaName: mode.mode.name!,
                count: mode.totalGames,
                finishedCount: mode.totalGamesFinished,
            };
        });
    }
    if (entity.platforms) {
        entity.distributionByPlatform = entity.platforms.map((platform) => {
            return {
                criteriaId: platform.platform.id,
                criteriaName: platform.platform.name!,
                count: platform.totalGames,
                finishedCount: platform.totalGamesFinished,
            };
        });
    }
}
