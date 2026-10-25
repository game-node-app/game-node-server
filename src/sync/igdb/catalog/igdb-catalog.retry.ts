import { CatalogDataError, CatalogSourceError } from "./igdb-catalog.client";
import { CATALOG_TIMING } from "./igdb-catalog.config";
import { CatalogOwnershipLost } from "./igdb-catalog-state.service";

export interface RetryRuntime {
    now(): number;
    random(): number;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export const retryRuntime: RetryRuntime = {
    now: Date.now,
    random: Math.random,
    sleep: (ms, signal) =>
        new Promise((resolve, reject) => {
            signal?.throwIfAborted();
            const abort = () => {
                clearTimeout(timer);
                reject(signal?.reason ?? new Error("Catalog stopped"));
            };
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", abort);
                resolve();
            }, ms);
            signal?.addEventListener("abort", abort, { once: true });
        }),
};

export function isTransientCatalogError(error: unknown): boolean {
    if (
        error instanceof CatalogDataError ||
        error instanceof CatalogOwnershipLost
    )
        return false;
    const failure = error as {
        code?: string;
        errno?: number;
        driverError?: { code?: string };
        status?: number;
    };
    const code = failure?.driverError?.code ?? failure?.code;
    return (
        (error instanceof CatalogSourceError &&
            (error.status === 429 ||
                (error.status !== undefined && error.status >= 500))) ||
        [
            "ECONNABORTED",
            "ETIMEDOUT",
            "ECONNRESET",
            "ECONNREFUSED",
            "EAI_AGAIN",
            "PROTOCOL_CONNECTION_LOST",
            "ER_LOCK_DEADLOCK",
            "ER_LOCK_WAIT_TIMEOUT",
            "ER_QUERY_TIMEOUT",
            "PROTOCOL_SEQUENCE_TIMEOUT",
        ].includes(code ?? "") ||
        failure?.errno === 1213 ||
        failure?.errno === 1205 ||
        failure?.errno === 3024
    );
}

export function catalogRetryDelay(
    attempt: number,
    error: unknown,
    runtime: RetryRuntime,
): number {
    const retryAfter =
        error instanceof CatalogSourceError ? error.retryAfter : undefined;
    if (retryAfter !== undefined) {
        const seconds = Number(retryAfter);
        const delay =
            retryAfter.trim() !== "" && Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(retryAfter) - runtime.now();
        if (Number.isFinite(delay))
            return Math.max(0, Math.min(CATALOG_TIMING.retryMaxMs, delay));
    }
    return Math.min(
        CATALOG_TIMING.retryMaxMs,
        CATALOG_TIMING.retryBaseMs * 2 ** (attempt - 1) +
            Math.min(250, Math.floor(Math.max(0, runtime.random()) * 251)),
    );
}

export interface CatalogAttemptBudget {
    read(): Promise<number>;
    increment(): Promise<number>;
    success(): Promise<void>;
}

/** Persist admission before each attempt; a restart cannot reset this budget. */
export async function runCatalogStage<T>(
    work: () => Promise<T>,
    budget: CatalogAttemptBudget,
    runtime: RetryRuntime = retryRuntime,
    maxAttempts = 3,
    signal?: AbortSignal,
): Promise<T> {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
        throw new CatalogDataError("Invalid catalog attempt limit");
    let used = await budget.read();
    if (used >= maxAttempts)
        throw new CatalogDataError(
            "Catalog stage attempt budget exhausted; run will resume after cooldown",
        );
    while (used < maxAttempts) {
        signal?.throwIfAborted();
        used = await budget.increment();
        try {
            const result = await work();
            await budget.success();
            return result;
        } catch (error) {
            if (
                signal?.aborted ||
                !isTransientCatalogError(error) ||
                used >= maxAttempts
            )
                throw error;
            await runtime.sleep(
                catalogRetryDelay(used, error, runtime),
                signal,
            );
        }
    }
    throw new CatalogDataError("Catalog attempt budget exhausted");
}
