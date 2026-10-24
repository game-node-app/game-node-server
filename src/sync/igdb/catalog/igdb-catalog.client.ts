import { IgdbOutboundBudgetService } from "./igdb-outbound-budget.service";
import { Inject, Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { IgdbAuthService } from "../auth/igdb-auth.service";
import { IgdbCatalogConfig } from "./igdb-catalog.config";
import { IGDB_CATALOG_FIELDS } from "./igdb-catalog.fields";

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
                            "https://api.igdb.com/v4/games",
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

    async fetchUpperId(signal?: AbortSignal): Promise<number> {
        const result = await this.request(
            "fields id; sort id desc; limit 1;",
            signal,
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
}
