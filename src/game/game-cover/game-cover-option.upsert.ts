import { EntityManager } from "typeorm";
import { GameCoverOption } from "./entities/game-cover-option.entity";
import { GameCoverKind, GameCoverOrigin } from "./game-cover.constants";

export interface GameCoverOptionValues {
    gameId: number;
    kind: GameCoverKind;
    origin: GameCoverOrigin;
    igdbId: number;
    label?: string | null;
    imageId?: string;
    url?: string;
    width?: number;
    height?: number;
    alphaChannel?: boolean;
    animated?: boolean;
    checksum?: string;
}

/** Copies the image columns shared by GameImage and GameCoverOption. */
export const coverOptionImage = (image: {
    imageId?: string;
    url?: string;
    width?: number;
    height?: number;
    alphaChannel?: boolean;
    animated?: boolean;
    checksum?: string;
}) => ({
    imageId: image.imageId,
    url: image.url,
    width: image.width,
    height: image.height,
    alphaChannel: image.alphaChannel,
    animated: image.animated,
    checksum: image.checksum,
});

/** Idempotent on (origin, igdbId): a changed source updates its row, keeping user choices. */
export async function upsertGameCoverOptions(
    manager: EntityManager,
    options: GameCoverOptionValues[],
) {
    if (options.length === 0) return;
    await manager
        .getRepository(GameCoverOption)
        .upsert(options, ["origin", "igdbId"]);
}
