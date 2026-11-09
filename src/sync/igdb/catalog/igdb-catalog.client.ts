import { IgdbOutboundBudgetService } from "./igdb-outbound-budget.service";
import { Inject, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { IgdbCatalogConfig } from "./igdb-catalog.config";
import { IGDB_CATALOG_FIELDS } from "./igdb-catalog.fields";

import { SyncEndpoint } from "./igdb-sync-endpoints";

export const CATALOG_CONFIG = Symbol("IGDB_CATALOG_CONFIG");
export interface RawCatalogGame extends Record<string, unknown> {
    id: number;
}
export class CatalogDataError extends Error {}
export class CatalogSourceError extends Error {
    constructor(
        public readonly status?: number,
        public readonly code?: string,
        public readonly retryAfter?: string,
    ) {
        super(`IGDB request failed (${status ?? code ?? "network"})`);
    }
}

@Injectable()
export class IgdbCatalogClient {
    constructor(
        private readonly http: HttpService,
        private readonly auth: IgdbAuthService,
        @Inject(CATALOG_CONFIG) private readonly config: IgdbCatalogConfig,
        private readonly budget: IgdbOutboundBudgetService,
    ) {}

    private async request(
        query: string,
        signal?: AbortSignal,
        endpoint = "games",
    ): Promise<RawCatalogGame[]> {
        for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
            const deadline = AbortSignal.timeout(this.config.httpTimeoutMs);
            const requestSignal = signal
                ? AbortSignal.any([signal, deadline])
                : deadline;
            try {
                const headers = await this.auth.getAuthHeaders(
                    authAttempt === 1,
                );
                const response = await this.budget.run(
                    () =>
                        this.http.axiosRef.post(
                            `https://api.igdb.com/v4/${endpoint}`,
                            query,
                            {
                                headers,
                                signal: requestSignal,
                                timeout: this.config.httpTimeoutMs,
                                maxContentLength: this.config.maxResponseBytes,
                            },
                        ),
                    requestSignal,
                );
                if (response.status < 200 || response.status >= 300)
                    throw new CatalogSourceError(
                        response.status,
                        undefined,
                        response.headers?.["retry-after"],
                    );
                if (!Array.isArray(response.data))
                    throw new CatalogDataError(
                        "IGDB response must be an array",
                    );
                for (const item of response.data) {
                    if (
                        !item ||
                        typeof item !== "object" ||
                        !Number.isSafeInteger(item.id) ||
                        item.id <= 0
                    )
                        throw new CatalogDataError(
                            "IGDB response contains an invalid game ID",
                        );
                }
                return response.data as RawCatalogGame[];
            } catch (error) {
                const failure = error as {
                    response?: {
                        status?: number;
                        headers?: Record<string, string>;
                    };
                    code?: string;
                };
                const status =
                    error instanceof CatalogSourceError
                        ? error.status
                        : failure.response?.status;
                if (status === 401 && authAttempt === 0) continue;
                if (
                    error instanceof CatalogDataError ||
                    error instanceof CatalogSourceError
                )
                    throw error;
                throw new CatalogSourceError(
                    status,
                    deadline.aborted ? "ETIMEDOUT" : failure.code,
                    failure.response?.headers?.["retry-after"],
                );
            }
        }
        throw new CatalogSourceError(401);
    }

    async fetchUpperId(
        signal?: AbortSignal,
        endpoint = "games",
    ): Promise<number> {
        const result = await this.request(
            "fields id; sort id desc; limit 1;",
            signal,
            endpoint,
        );
        if (result.length > 1)
            throw new CatalogDataError(
                "IGDB upper-bound response contains multiple games",
            );
        return result[0]?.id ?? 0;
    }

    async fetchPage(
        afterId: number,
        upperId: number,
        limit: number,
        signal?: AbortSignal,
    ): Promise<RawCatalogGame[]> {
        if (
            !Number.isSafeInteger(afterId) ||
            afterId < 0 ||
            !Number.isSafeInteger(upperId) ||
            upperId < afterId ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > this.config.batchSize
        )
            throw new CatalogDataError("Invalid catalog page bounds");
        const result = await this.request(
            `fields ${IGDB_CATALOG_FIELDS.join(",")}; sort id asc; where id > ${afterId} & id <= ${upperId}; limit ${limit};`,
            signal,
        );
        if (result.length > limit)
            throw new CatalogDataError("IGDB page exceeds requested limit");
        let previous = afterId;
        for (const game of result) {
            if (game.id <= previous || game.id > upperId)
                throw new CatalogDataError(
                    "IGDB page IDs must be ascending and within the scan boundary",
                );
            previous = game.id;
        }
        return result;
    }
    private validatePage(
        rows: RawCatalogGame[],
        after: number,
        upper: number,
        limit: number,
    ) {
        if (rows.length > limit)
            throw new CatalogDataError("IGDB page exceeds requested limit");
        for (const row of rows) {
            if (row.id <= after || row.id > upper)
                throw new CatalogDataError(
                    "IGDB page IDs must be ascending and within bounds",
                );
            after = row.id;
        }
        return rows;
    }
    async fetchSweepPage(
        entry: SyncEndpoint,
        after: number,
        upper: number,
        signal?: AbortSignal,
    ) {
        if (
            !Number.isSafeInteger(after) ||
            after < 0 ||
            !Number.isSafeInteger(upper) ||
            upper < after
        )
            throw new CatalogDataError("Invalid sweep bounds");
        const fields = [
            "id",
            "checksum",
            ...(entry.owner === "game" ? ["game"] : []),
            ...entry.compare.map((field) => field.source),
            ...(entry.sweepFields ?? []),
        ];
        return this.validatePage(
            await this.request(
                `fields ${fields.join(",")}; where id > ${after} & id <= ${upper}; sort id asc; limit 500;`,
                signal,
                entry.endpoint,
            ),
            after,
            upper,
            500,
        );
    }
    async fetchDeltaPage(
        entry: SyncEndpoint,
        start: Date,
        end: Date,
        after: number,
        signal?: AbortSignal,
    ) {
        const a = Math.floor(+start / 1000),
            b = Math.floor(+end / 1000);
        if (
            !Number.isSafeInteger(a) ||
            a < 0 ||
            !Number.isSafeInteger(b) ||
            b <= a ||
            !Number.isSafeInteger(after) ||
            after < 0
        )
            throw new CatalogDataError("Invalid delta window");
        const limit = entry.endpoint === "games" ? this.config.batchSize : 500;
        const fields = [...new Set([...entry.fields, "updated_at"])];
        const rows = this.validatePage(
            await this.request(
                `fields ${fields.join(",")}; where updated_at >= ${a} & updated_at < ${b} & id > ${after}; sort id asc; limit ${limit};`,
                signal,
                entry.endpoint,
            ),
            after,
            Number.MAX_SAFE_INTEGER,
            limit,
        );
        for (const row of rows)
            if (
                !Number.isSafeInteger(row.updated_at) ||
                Number(row.updated_at) < a ||
                Number(row.updated_at) >= b
            )
                throw new CatalogDataError(
                    "IGDB response outside delta window",
                );
        return rows;
    }
    async fetchByIds(entry: SyncEndpoint, ids: number[], signal?: AbortSignal) {
        const limit = entry.endpoint === "games" ? this.config.batchSize : 500;
        if (
            !ids.length ||
            ids.length > limit ||
            ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
        )
            throw new CatalogDataError("Invalid refresh IDs");
        const rows = this.validatePage(
            await this.request(
                `fields ${entry.fields.join(",")}; where id = (${ids.join(",")}); sort id asc; limit ${limit};`,
                signal,
                entry.endpoint,
            ),
            0,
            Number.MAX_SAFE_INTEGER,
            limit,
        );
        if (rows.some((row) => !ids.includes(row.id)))
            throw new CatalogDataError("IGDB returned an unrequested ID");
        return rows;
    }
    /** Design 7: one expanded image query for every option source batch. */
    async fetchOptionSources(
        entry: SyncEndpoint,
        ids: number[],
        signal?: AbortSignal,
    ) {
        if (entry.endpoint !== "covers" && entry.endpoint !== "artworks")
            throw new CatalogDataError("Unsupported option source endpoint");
        if (
            !ids.length ||
            ids.length > 500 ||
            ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
        )
            throw new CatalogDataError("Invalid option source IDs");
        const fields = [
            "id",
            "alpha_channel",
            "animated",
            "checksum",
            "game",
            "height",
            "image_id",
            "url",
            "width",
            ...(entry.endpoint === "covers"
                ? ["game_localization.game", "game_localization.region.*"]
                : []),
        ];
        const rows = this.validatePage(
            await this.request(
                `fields ${fields.join(",")}; where id = (${ids.join(",")}); sort id asc; limit 500;`,
                signal,
                entry.endpoint,
            ),
            0,
            Number.MAX_SAFE_INTEGER,
            500,
        );
        if (rows.some((row) => !ids.includes(row.id)))
            throw new CatalogDataError("IGDB returned an unrequested ID");
        return rows;
    }
}
