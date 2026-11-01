export const EXTERNAL_GAME_MAPPING_QUEUE = "external-game-mapping";
export const EPIC_NAMESPACE_FILL_JOB = "epic-namespace-fill";

export interface EpicNamespaceFillJobData {
    /** Highest IGDB Epic row id already processed; lets a retried job resume. */
    lastId?: number;
    /** namespace -> gameId -> candidate, kept so a resumed run still sees the earlier pages. */
    groups?: Record<string, Record<string, EpicNamespaceCandidate>>;
    slugs?: number;
    resolved?: number;
}

export interface EpicNamespaceCandidate {
    category: number;
    slug: string;
}

export interface EpicNamespaceFillSummary {
    slugs: number;
    resolved: number;
    failed: number;
    mapped: number;
    ambiguous: number;
}
