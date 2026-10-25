export type ProviderFailureOutcome =
    | "unsupported"
    | "unavailable"
    | "throttled"
    | "incomplete"
    | "failed"
    | "reauth_required";

const causes = new WeakMap<ProviderSyncError, unknown>();

export class ProviderSyncError extends Error {
    constructor(
        readonly outcome: ProviderFailureOutcome,
        message: string,
        cause?: unknown,
        readonly status?: number,
        readonly retryAfterMs?: number,
    ) {
        super(message);
        // BullMQ recognizes this name as terminal; keep the provider outcome for logging.
        this.name =
            outcome === "reauth_required"
                ? "UnrecoverableError"
                : "ProviderSyncError";
        // Keep raw request credentials out of ordinary error inspection/serialization.
        causes.set(this, cause);
    }

    get cause(): unknown {
        return causes.get(this);
    }
}

export function providerFailure(
    provider: string,
    cause: unknown,
): ProviderSyncError {
    if (cause instanceof ProviderSyncError) return cause;
    const failure = cause as {
        status?: number;
        data?: {
            attributes?: {
                extra?: {
                    statusCode?: number;
                    response?: { headers?: Record<string, unknown> };
                };
            };
        };
        response?: { status?: number; headers?: Record<string, unknown> };
    } | null;
    const extra = failure?.data?.attributes?.extra;
    const status =
        failure?.response?.status ?? failure?.status ?? extra?.statusCode;
    const rawRetryAfter =
        failure?.response?.headers?.["retry-after"] ??
        extra?.response?.headers?.["retry-after"];
    let retryAfterMs: number | undefined;
    if (
        typeof rawRetryAfter === "string" ||
        typeof rawRetryAfter === "number"
    ) {
        const value = String(rawRetryAfter).trim();
        const seconds = Number(value);
        const delay =
            value !== "" && Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(value) - Date.now();
        if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
    }
    const outcome =
        status === 429
            ? "throttled"
            : status === 401 || status === 403
              ? "unavailable"
              : "failed";
    return new ProviderSyncError(
        outcome,
        `${provider} request ${outcome}`,
        cause,
        status,
        retryAfterMs,
    );
}

export async function providerCall<T>(
    provider: string,
    call: () => Promise<T>,
): Promise<T> {
    try {
        return await call();
    } catch (cause) {
        throw providerFailure(provider, cause);
    }
}
