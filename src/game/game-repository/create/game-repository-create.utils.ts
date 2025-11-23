import { EntityTarget, ObjectLiteral, Repository } from "typeorm";
import { IGDBPartialGame } from "../game-repository.types";
import { Game } from "../entities/game.entity";
import { GameGenre } from "../entities/game-genre.entity";
import { GamePlatform } from "../entities/game-platform.entity";
import { GameTheme } from "../entities/game-theme.entity";
import { GameFranchise } from "../entities/game-franchise.entity";

interface ObjectWithChecksum extends ObjectLiteral {
    id: number;
    checksum?: string;
}

export function hasChecksumChanged(
    incoming: ObjectWithChecksum[],
    existing: ObjectWithChecksum[] | undefined,
): boolean {
    if (existing === undefined || existing.length !== incoming.length) {
        return true;
    }

    const incomingMap = new Map(
        incoming.map((item) => [item.id, item.checksum]),
    );
    const existingMap = new Map(
        existing.map((item) => [item.id, item.checksum]),
    );

    for (const [id, checksum] of incomingMap) {
        if (existingMap.get(id) !== checksum) {
            return true;
        }
    }

    return false;
}

export const GamePropertyPathToEntityMap: Partial<
    Record<keyof Game, EntityTarget<ObjectLiteral>>
> = {
    genres: GameGenre,
    platforms: GamePlatform,
    themes: GameTheme,
    franchises: GameFranchise,
};

export async function handleManyToMany<T extends ObjectWithChecksum>(
    incoming: IGDBPartialGame,
    existing: Game,
    propertyPath: keyof Game,
    repository: Repository<T>,
) {
    const incomingData = incoming[propertyPath] as T[] | undefined;
    const existingData = existing[propertyPath] as unknown as T[] | undefined;

    if (incomingData == undefined) {
        return;
    }
    if (!hasChecksumChanged(incomingData, existingData)) {
        return;
    }

    const incomingParsed = incomingData.map((item) =>
        repository.create({ ...item, game: existing, gameId: existing.id }),
    );

    const existingNotInIncoming = existingData?.filter((item) => {
        return !incomingData.some(
            (incomingItem) => incomingItem.id === item.id,
        );
    });

    const incomingNotInExisting = incomingData?.filter((item) => {
        if (!existingData) return true;

        return !existingData.some(
            (existingItem) => existingItem.id === item.id,
        );
    });

    await repository.upsert(incomingParsed, ["id"]);

    await repository
        .createQueryBuilder()
        .relation(Game, propertyPath)
        .of(existing)
        // Only adds or removes entries when necessary
        .addAndRemove(incomingNotInExisting, existingNotInIncoming);
}

/**
 * The same logic applies for
 */
export async function handleOneToMany<T extends ObjectWithChecksum>(
    incoming: IGDBPartialGame,
    existing: Game,
    propertyPath: keyof Game,
    repository: Repository<T>,
) {
    const incomingData = incoming[propertyPath] as T[] | undefined;
    const existingData = existing[propertyPath] as unknown as T[];

    if (incomingData == undefined) {
        return;
    }
    if (!hasChecksumChanged(incomingData, existingData)) {
        return;
    }

    const incomingParsed = incomingData.map((item) =>
        repository.create({ ...item, game: existing, gameId: existing.id }),
    );
    await repository.upsert(incomingParsed, ["id"]);
}

export async function handleOneToOne<T extends ObjectWithChecksum>(
    incoming: IGDBPartialGame,
    existing: Game,
    propertyPath: keyof Game,
    repository: Repository<T>,
) {
    const incomingData = incoming[propertyPath] as T | undefined;
    const existingData = existing[propertyPath] as T | undefined;

    if (incomingData == undefined) {
        return;
    }
    if (
        existingData &&
        incomingData.id === existingData.id &&
        incomingData.checksum === existingData.checksum
    ) {
        return;
    }

    await repository.upsert(incomingData, ["id"]);

    await repository
        .createQueryBuilder()
        .relation(Game, propertyPath)
        .of(existing)
        .set(incomingData);
}
