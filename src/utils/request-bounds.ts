import { Transform } from "class-transformer";
import { ValidateBy } from "class-validator";

/** Default cap for a page's `limit`. */
export const MAX_PAGE_LIMIT = 100;
/** Cap for the few endpoints whose clients load a whole set at once (release calendar, collection, achievements). */
export const MAX_LARGE_PAGE_LIMIT = 1000;
/** Cap for id and filter lists in request bodies. */
export const MAX_REQUEST_LIST_SIZE = 1000;

const MAX_RELATION_DEPTH = 2;
const MAX_RELATION_PATHS = 20;

/**
 * Caps a page `limit` at `max` instead of rejecting it, so older clients that ask for "everything" still get a page.
 * Reads the raw value, so a subclass's cap replaces the base class's instead of stacking with it.
 */
export function ClampLimit(max: number) {
    return Transform(({ obj, key }) => {
        const raw = (obj as Record<string, unknown>)[key];
        // Same conversion enableImplicitConversion would apply; invalid values are left for the validators.
        const value = typeof raw === "string" ? Number(raw) : raw;
        return typeof value === "number" && value > max ? max : value;
    });
}

/** Rejects arrays longer than `max`; non-array values are left to the other validators. */
export function MaxListSize(max: number = MAX_REQUEST_LIST_SIZE) {
    return ValidateBy({
        name: "maxListSize",
        validator: {
            validate: (value) => !Array.isArray(value) || value.length <= max,
            defaultMessage: (args) =>
                `${args?.property} must contain at most ${max} items`,
        },
    });
}

/** Number of relation paths in a TypeORM relations object, or Infinity when it nests too deep. */
export function countRelationPaths(relations: object, depth = 1): number {
    if (depth > MAX_RELATION_DEPTH) return Infinity;
    let paths = 0;
    for (const nested of Object.values(relations)) {
        paths += 1;
        if (typeof nested === "object" && nested !== null)
            paths += countRelationPaths(nested, depth + 1);
    }
    return paths;
}

/** Bounds a client-chosen relations object, so one request can't join a large part of the catalog. */
export function IsBoundedRelations() {
    return ValidateBy({
        name: "isBoundedRelations",
        validator: {
            validate: (value) =>
                typeof value !== "object" ||
                value === null ||
                countRelationPaths(value) <= MAX_RELATION_PATHS,
            defaultMessage: () =>
                `relations must be at most ${MAX_RELATION_DEPTH} levels deep with at most ${MAX_RELATION_PATHS} paths`,
        },
    });
}
