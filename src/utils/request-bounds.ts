import { Transform } from "class-transformer";
import { ValidateBy } from "class-validator";

/** Default cap for a page's `limit`. */
export const MAX_PAGE_LIMIT = 100;
/** Cap for the few endpoints whose clients load a whole set at once (release calendar, collection, achievements). */
export const MAX_LARGE_PAGE_LIMIT = 1000;
/** Cap for id and filter lists in request bodies. */
export const MAX_REQUEST_LIST_SIZE = 1000;

/** Deepest page a client may ask for; MySQL reads and discards every skipped row. */
export const MAX_OFFSET = 10000;
/** Rows one request may load: items times the rows each item's relations add. 1000 games with cover and platforms fit. */
export const MAX_RELATION_ROWS = 3000;

const MAX_RELATION_DEPTH = 2;
const MAX_RELATION_PATHS = 20;
/** Rough rows a nested relation adds per parent (similar games, DLCs, companies...). */
const NESTED_RELATION_FAN_OUT = 10;

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

/** Game relations that load a list of whole games, so even `similarGames: true` fans out. */
const GAME_LIST_RELATIONS = new Set([
    "dlcs",
    "dlcOf",
    "expansions",
    "expansionOf",
    "expandedGames",
    "expandedGameOf",
    "similarGames",
    "similarGameOf",
    "remakes",
    "remakeOf",
    "remasters",
    "remasterOf",
]);

/** Rows one item costs with these relations: itself, one per flat relation, a fan-out per nested one or game list. */
export function relationRowCost(relations: object): number {
    let cost = 1;
    for (const [name, nested] of Object.entries(relations)) {
        if (typeof nested === "object" && nested !== null)
            cost += NESTED_RELATION_FAN_OUT * relationRowCost(nested);
        else if (nested)
            cost += GAME_LIST_RELATIONS.has(name) ? NESTED_RELATION_FAN_OUT : 1;
    }
    return cost;
}

/**
 * Bounds a client-chosen relations object, so one request can't join a large part of the catalog.
 * `itemsOf` reads how many items the request loads (ids, page size) from the DTO, to cap the total rows too.
 */
export function IsBoundedRelations<T>(itemsOf: (dto: T) => number = () => 1) {
    return ValidateBy({
        name: "isBoundedRelations",
        validator: {
            validate: (value, args) =>
                typeof value !== "object" ||
                value === null ||
                (countRelationPaths(value) <= MAX_RELATION_PATHS &&
                    itemsOf(args!.object as T) * relationRowCost(value) <=
                        MAX_RELATION_ROWS),
            defaultMessage: () =>
                `relations must be at most ${MAX_RELATION_DEPTH} levels deep with at most ${MAX_RELATION_PATHS} paths, and load at most ${MAX_RELATION_ROWS} rows in total; request fewer items or relations`,
        },
    });
}
