const ROLES = ["all", "api", "worker"] as const;
export type AppRole = (typeof ROLES)[number];

export function parseAppRole(value: string | undefined): AppRole {
    const role = value || "all";
    if (!ROLES.includes(role as AppRole)) {
        throw new Error(`Invalid APP_ROLE "${role}", expected one of ${ROLES.join(", ")}`);
    }
    return role as AppRole;
}

/**
 * api: serves HTTP only, so it can be replicated.
 * worker: runs crons, queue workers and boot-time jobs; keep exactly one.
 * all: both, for development and single-instance deploys.
 */
export const APP_ROLE = parseAppRole(process.env.APP_ROLE);
export const RUNS_BACKGROUND_WORK = APP_ROLE !== "api";
