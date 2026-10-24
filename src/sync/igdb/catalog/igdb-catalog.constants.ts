export const IGDB_CATALOG_QUEUE_NAME = "igdb-catalog";
export const IGDB_OUTBOUND_BUDGET_QUEUE_NAME = "igdb-outbound-budget";
export const IGDB_CATALOG_JOB_NAME = "catalog-run";
export const CATALOG_JOB_OPTIONS = {
    attempts: 1,
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 10 },
} as const;
export const catalogJobId = (runId: string) => `igdb-catalog-${runId}`;
