import { FindOneOptions, FindOptionsRelations } from "typeorm";

/**
 * Gets the most performant relation strategy based on amount of relations being loaded.
 * @see https://github.com/typeorm/typeorm/issues/3857
 * @param relations
 */
export function getRelationLoadStrategy(
    relations: FindOptionsRelations<any> | undefined,
): FindOneOptions["relationLoadStrategy"] {
    if (relations == undefined) return "join";

    /**
     * Maximum number of relations allowed to be used with the "join" method.
     * Anything above this will greatly reduce performance.
     */
    const MAX_JOIN_RELATION_COUNT = 2;

    let totalQueriedEntries = 0;

    for (const [key, value] of Object.entries(relations)) {
        if (typeof value === "string" && value.length > 0) {
            totalQueriedEntries += value.split(".").length;

            // e.g. { cover: true }
        } else if (value != undefined && value) {
            totalQueriedEntries += 1;
        }
    }

    if (totalQueriedEntries >= MAX_JOIN_RELATION_COUNT) {
        return "query";
    }

    return "join";
}
