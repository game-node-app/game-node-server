import { InvalidGameEntryError } from "../../../game/game-repository/create/game-import-context";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DataSource, In, QueryFailedError } from "typeorm";
import { GameCompany } from "../../../game/game-repository/entities/game-company.entity";
import { GameCompanyLogo } from "../../../game/game-repository/entities/game-company-logo.entity";
import { normalizeIgdbGame } from "../utils/game-conversor-utils";
import { AsyncLeafLimiter } from "./async-leaf-limiter";
import {
    CATALOG_CONFIG,
    CatalogDataError,
    IgdbCatalogClient,
    RawCatalogGame,
} from "./igdb-catalog.client";
import { IgdbCatalogConfig } from "./igdb-catalog.config";
import { IgdbCatalogImportService } from "./igdb-catalog-import.service";
import { isTransientCatalogError } from "./igdb-catalog.retry";
import {
    IgdbCatalogStateService,
    OwnershipAssertion,
} from "./igdb-catalog-state.service";
import { IGDB_SYNC_ENDPOINTS, SyncEndpoint } from "./igdb-sync-endpoints";

@Injectable()
export class IgdbRefreshService {
    private readonly logger = new Logger(IgdbRefreshService.name);
    constructor(
        private readonly source: DataSource,
        private readonly client: IgdbCatalogClient,
        private readonly importer: IgdbCatalogImportService,
        private readonly transactions: IgdbCatalogStateService,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
    ) {}

    private async persist(
        raw: RawCatalogGame,
        guard: OwnershipAssertion,
        limiter: AsyncLeafLimiter,
        force: boolean,
    ) {
        try {
            await this.importer.persist(
                normalizeIgdbGame(raw),
                guard,
                limiter,
                force,
            );
        } catch (error) {
            const rowFailure =
                error instanceof QueryFailedError &&
                !isTransientCatalogError(error);
            if (!(error instanceof InvalidGameEntryError) && !rowFailure)
                throw error;
            const failure = error as Error & {
                code?: string;
                driverError?: { code?: string };
            };
            this.logger.warn({
                event: "catalog.game.skipped",
                gameId: raw.id,
                reason: failure.message,
                code: failure.driverError?.code ?? failure.code,
            });
        }
    }
    async mismatches(entry: SyncEndpoint, rows: RawCatalogGame[]) {
        if (!rows.length) return [];
        if (entry.owner === "game")
            rows = rows.filter(
                (row) => row.game !== undefined && row.game !== null,
            );
        if (!rows.length) return [];
        const repo = this.source.getRepository(entry.local.entity);
        const ownerRelation =
            entry.local.columns.includes("gameId") &&
            !repo.metadata.columns.some(
                (column) => column.propertyName === "gameId",
            );
        const local = await repo.find({
            select: {
                ...(ownerRelation ? { game: { id: true } } : {}),
                ...Object.fromEntries(
                    [
                        ...entry.local.columns.filter(
                            (column) => column !== "gameId" || !ownerRelation,
                        ),
                        ...entry.compare
                            .filter((field) => !field.relation)
                            .map((field) => field.column),
                        ...(entry.endpoint === "external_games"
                            ? ["origin"]
                            : []),
                    ].map((column) => [column, true]),
                ),
            },
            where: { id: In(rows.map((row) => row.id)) },
            relations: {
                ...(ownerRelation ? { game: true } : {}),
                ...Object.fromEntries(
                    entry.compare
                        .filter((field) => field.relation)
                        .map((field) => [field.relation!, true]),
                ),
            },
        });
        const byId = new Map(local.map((row) => [Number(row.id), row]));
        const available = new Map<string, Set<number>>();
        for (const field of entry.compare)
            if (field.target) {
                const ids = rows
                    .flatMap((row) =>
                        Array.isArray(row[field.source])
                            ? (row[field.source] as number[])
                            : [row[field.source] as number],
                    )
                    .filter(Number.isSafeInteger);
                available.set(
                    field.source,
                    new Set(
                        (
                            await this.source.getRepository(field.target).find({
                                select: { id: true },
                                where: { id: In(ids) },
                            })
                        ).map((row) => Number(row.id)),
                    ),
                );
            }
        return rows.filter((row) => {
            const stored = byId.get(row.id);
            if (
                entry.endpoint === "external_games" &&
                stored &&
                stored.origin !== "igdb"
            )
                return false;
            if (!stored || stored.checksum !== row.checksum) return true;
            if (
                entry.owner === "game" &&
                entry.local.columns.includes("gameId") &&
                Number(stored.gameId ?? stored.game?.id) !== row.game
            )
                return true;
            return entry.compare.some((field) => {
                const source = row[field.source];
                const targets = available.get(field.source);
                if (Array.isArray(source)) {
                    const wanted = source
                        .filter((id) => !targets || targets.has(Number(id)))
                        .map(Number)
                        .sort((a, b) => a - b);
                    const values = (
                        field.relation
                            ? stored[field.relation].map((link: any) => link.id)
                            : (stored[field.column] ?? [])
                    )
                        .map(Number)
                        .sort((a: number, b: number) => a - b);
                    return JSON.stringify(wanted) !== JSON.stringify(values);
                }
                return (
                    (!targets ||
                        source == null ||
                        targets.has(Number(source))) &&
                    (source == null
                        ? stored[field.column] != null
                        : Number(source) !== Number(stored[field.column]))
                );
            });
        });
    }
    async apply(
        entry: SyncEndpoint,
        rows: RawCatalogGame[],
        guard: OwnershipAssertion,
        limiter: AsyncLeafLimiter,
        force = false,
        expanded = false,
        signal?: AbortSignal,
    ) {
        signal?.throwIfAborted();
        if (entry.route === "game") {
            if (entry.endpoint === "games" && expanded) {
                for (const row of rows) {
                    signal?.throwIfAborted();
                    await this.persist(row, guard, limiter, force);
                }
                return;
            }
            const ids = [
                ...new Set(
                    rows.map((row) =>
                        entry.owner === "game" ? (row.game as number) : row.id,
                    ),
                ),
            ];
            if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
                throw new CatalogDataError("Invalid refresh parent ID");
            for (
                let index = 0;
                index < ids.length;
                index += this.config.batchSize
            ) {
                signal?.throwIfAborted();
                await this.source.transaction(guard);
                const chunk = ids.slice(index, index + this.config.batchSize);
                const games = await this.client.fetchByIds(
                    IGDB_SYNC_ENDPOINTS[0],
                    chunk,
                    signal,
                );
                for (const id of chunk)
                    if (!games.some((game) => game.id === id))
                        this.logger.warn({
                            event: "catalog.parent.missing",
                            gameId: id,
                            endpoint: entry.endpoint,
                        });
                for (const game of games) {
                    signal?.throwIfAborted();
                    await this.persist(game, guard, limiter, force);
                }
            }
            return;
        }
        let target = entry;
        let ids = rows.map((row) => row.id);
        if (entry.owner === "companies") {
            const companies = await this.source
                .getRepository(GameCompany)
                .find({
                    where: { logo: { id: In(ids) } },
                    select: { id: true },
                });
            ids = companies.map((company) => company.id);
            target = IGDB_SYNC_ENDPOINTS.find(
                (item) => item.endpoint === "companies",
            )!;
        }
        const local = await this.source
            .getRepository(target.local.entity)
            .find({ select: { id: true }, where: { id: In(ids) } });
        ids = local.map((row) => Number(row.id));
        if (!ids.length) return;
        for (let index = 0; index < ids.length; index += 500) {
            signal?.throwIfAborted();
            await this.source.transaction(guard);
            const chunk = ids.slice(index, index + 500);
            const entities =
                expanded && entry.owner !== "companies"
                    ? rows.filter((row) => chunk.includes(row.id))
                    : await this.client.fetchByIds(target, chunk, signal);
            for (const raw of entities) {
                signal?.throwIfAborted();
                await this.transactions.gameTransaction(
                    guard,
                    async (manager) => {
                        const repo = manager.getRepository(target.local.entity);
                        if (
                            !(await repo.findOne({
                                where: { id: raw.id },
                                lock: { mode: "pessimistic_write" },
                            }))
                        )
                            return;
                        const row = normalizeIgdbGame(raw) as any;
                        if (target.endpoint === "companies") {
                            row.parentId =
                                typeof row.parent === "number" &&
                                (await repo.existsBy({ id: row.parent }))
                                    ? row.parent
                                    : null;
                            delete row.parent;
                            if (row.logo && typeof row.logo === "object")
                                await manager
                                    .getRepository(GameCompanyLogo)
                                    .upsert(row.logo, ["id"]);
                        }
                        const values = Object.fromEntries(
                            repo.metadata.columns
                                .filter((column) => column.propertyName in row)
                                .map((column) => [
                                    column.propertyName,
                                    row[column.propertyName],
                                ]),
                        );
                        if (row.logo && typeof row.logo === "object")
                            values.logo = row.logo;
                        await repo.update(raw.id, values);
                    },
                );
            }
        }
    }
}
