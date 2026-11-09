import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { GameCover } from "../../../game/game-repository/entities/game-cover.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { GameCoverOption } from "../../../game/game-cover/entities/game-cover-option.entity";
import {
    GameCoverKind,
    GameCoverOrigin,
} from "../../../game/game-cover/game-cover.constants";
import {
    coverOptionImage,
    GameCoverOptionValues,
    upsertGameCoverOptions,
} from "../../../game/game-cover/game-cover-option.upsert";
import { IgdbCatalogClient, RawCatalogGame } from "./igdb-catalog.client";
import {
    CatalogOwner,
    IgdbCatalogStateService,
} from "./igdb-catalog-state.service";
import { SyncEndpoint } from "./igdb-sync-endpoints";

// image_type numbering is shared by covers and artworks.
const HISTORICAL_COVER = 9;
const ALTERNATIVE_COVER = 10;
// Deprecated artwork_type swaps the two. IGDB leaves image_type empty on about half of the
// rows that still carry it, so it is only the fallback.
const LEGACY_ALTERNATIVE_ARTWORK = 9;
const LEGACY_HISTORICAL_ARTWORK = 10;

const artworkKind = (row: RawCatalogGame) => {
    if (row.image_type != null)
        return row.image_type === ALTERNATIVE_COVER
            ? GameCoverKind.Alternative
            : row.image_type === HISTORICAL_COVER
              ? GameCoverKind.Historical
              : null;
    return row.artwork_type === LEGACY_ALTERNATIVE_ARTWORK
        ? GameCoverKind.Alternative
        : row.artwork_type === LEGACY_HISTORICAL_ARTWORK
          ? GameCoverKind.Historical
          : null;
};

interface OptionSource {
    row: RawCatalogGame;
    origin: GameCoverOrigin;
    kind: GameCoverKind;
}

/** Expanded fields return references as either IDs or objects with an id. */
const referenceId = (value: unknown) =>
    Number(
        value && typeof value === "object"
            ? (value as { id?: number }).id
            : value,
    );

/**
 * Design 7: routes non-primary covers and alternative or historical artworks to the
 * cover option catalog. Cover option sources leave the normal refresh path; artworks
 * stay on it because they are already stored in game_artwork.
 */
@Injectable()
export class IgdbCoverOptionService {
    constructor(
        private readonly source: DataSource,
        private readonly client: IgdbCatalogClient,
        private readonly transactions: IgdbCatalogStateService,
    ) {}

    /** Writes stale option sources and returns the rows the normal path must still process. */
    async syncPage(
        entry: SyncEndpoint,
        rows: RawCatalogGame[],
        owner: CatalogOwner,
        signal?: AbortSignal,
    ) {
        const { sources, remaining } = await this.classify(entry, rows);
        if (!sources.length) return remaining;
        const stored = await this.source.getRepository(GameCoverOption).find({
            where: {
                origin: sources[0].origin,
                igdbId: In(sources.map((source) => source.row.id)),
            },
        });
        const byIgdbId = new Map(
            stored.map((option) => [Number(option.igdbId), option]),
        );
        const stale = sources.filter(
            (source) =>
                byIgdbId.get(Number(source.row.id))?.checksum !==
                source.row.checksum,
        );
        if (!stale.length) return remaining;
        const options = await this.fetchOptions(entry, stale, signal);
        if (!options.length) return remaining;
        const existing = new Set(
            (
                await this.source.getRepository(Game).find({
                    select: { id: true },
                    where: {
                        id: In([
                            ...new Set(options.map((option) => option.gameId)),
                        ]),
                    },
                })
            ).map((game) => Number(game.id)),
        );
        const writable = options.filter((option) =>
            existing.has(Number(option.gameId)),
        );
        if (writable.length)
            await this.transactions.gameTransaction(owner, (manager) =>
                upsertGameCoverOptions(manager, writable),
            );
        return remaining;
    }

    private async classify(entry: SyncEndpoint, rows: RawCatalogGame[]) {
        const sources: OptionSource[] = [];
        if (entry.endpoint === "covers") {
            const candidates = rows.filter(
                (row) =>
                    row.game_localization != null ||
                    row.image_type === HISTORICAL_COVER ||
                    row.image_type === ALTERNATIVE_COVER,
            );
            const primary = new Set(
                candidates.length
                    ? (
                          await this.source.getRepository(GameCover).find({
                              select: { id: true },
                              where: {
                                  id: In(candidates.map((row) => row.id)),
                              },
                          })
                      ).map((cover) => Number(cover.id))
                    : [],
            );
            const optionRows = candidates.filter(
                (row) => !primary.has(Number(row.id)),
            );
            for (const row of optionRows)
                sources.push({
                    row,
                    origin: GameCoverOrigin.Cover,
                    kind:
                        row.game_localization != null
                            ? GameCoverKind.Localized
                            : row.image_type === HISTORICAL_COVER
                              ? GameCoverKind.Historical
                              : GameCoverKind.Alternative,
                });
            const sourceIds = new Set(sources.map((source) => source.row.id));
            return {
                sources,
                remaining: rows.filter((row) => !sourceIds.has(row.id)),
            };
        }
        if (entry.endpoint === "artworks") {
            for (const row of rows) {
                const kind = artworkKind(row);
                if (kind)
                    sources.push({
                        row,
                        origin: GameCoverOrigin.Artwork,
                        kind,
                    });
            }
        }
        return { sources, remaining: rows };
    }

    private async fetchOptions(
        entry: SyncEndpoint,
        sources: OptionSource[],
        signal?: AbortSignal,
    ) {
        const options: GameCoverOptionValues[] = [];
        for (let index = 0; index < sources.length; index += 500) {
            signal?.throwIfAborted();
            const chunk = sources.slice(index, index + 500);
            const rows = await this.client.fetchOptionSources(
                entry,
                chunk
                    .map((source) => source.row.id)
                    .sort((first, second) => first - second),
                signal,
            );
            const byId = new Map(rows.map((row) => [Number(row.id), row]));
            for (const source of chunk) {
                const row = byId.get(Number(source.row.id));
                const option = row && this.optionValues(source, row);
                if (option) options.push(option);
            }
        }
        return options;
    }

    private optionValues(
        source: OptionSource,
        row: RawCatalogGame,
    ): GameCoverOptionValues | null {
        const localization = row.game_localization as
            | { game?: unknown; region?: { name?: string } }
            | undefined;
        const localized = source.kind === GameCoverKind.Localized;
        const gameId = referenceId(localized ? localization?.game : row.game);
        if (!Number.isSafeInteger(gameId) || gameId <= 0) return null;
        return {
            gameId,
            kind: source.kind,
            origin: source.origin,
            igdbId: Number(row.id),
            label: localized ? (localization?.region?.name ?? null) : null,
            ...coverOptionImage({
                imageId: row.image_id as string,
                url: row.url as string,
                width: row.width as number,
                height: row.height as number,
                alphaChannel: row.alpha_channel as boolean,
                animated: row.animated as boolean,
                checksum: row.checksum as string,
            }),
        };
    }
}
