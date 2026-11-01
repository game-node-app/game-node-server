import { assertPlayerSyncActive } from "../player-sync-attempt";
import { ExternalGameService } from "../../game/external-game/external-game.service";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import { EpicSyncService } from "./epic-sync.service";
import { EpicLibraryItem } from "./epic-sync.types";

/**
 * Registers unmapped Epic namespaces for a user. Library items carry no title, so the catalog is asked
 * once per namespace, and only for namespaces whose entry has no name yet.
 */
export async function registerUnmappedEpicNamespaces(
    externalGameService: ExternalGameService,
    epicSyncService: EpicSyncService,
    userId: string,
    accountId: string,
    libraryItems: EpicLibraryItem[],
    unmapped: string[],
) {
    const category = EGameExternalGameCategory.EpicGamesNamespace;
    const named = await externalGameService.findNamedUnmappedUids(
        category,
        unmapped,
    );
    const itemsByNamespace = Map.groupBy(
        libraryItems,
        (item) => item.namespace,
    );
    const entries: { sourceUid: string; name?: string }[] = [];
    for (const sourceUid of unmapped) {
        assertPlayerSyncActive();
        entries.push({
            sourceUid,
            name: named.has(sourceUid)
                ? undefined
                : await epicSyncService.getCatalogTitle(
                      accountId,
                      sourceUid,
                      (itemsByNamespace.get(sourceUid) ?? []).map(
                          (item) => item.catalogItemId,
                      ),
                  ),
        });
    }
    await externalGameService.registerUnmappedGames(category, entries, userId);
}
