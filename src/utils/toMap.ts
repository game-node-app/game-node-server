type IdentifierType<T, K extends keyof T> = T[K] extends number
    ? number
    : T[K] extends string
      ? string
      : T[K] extends string | undefined
        ? string
        : symbol;

/**
 * Converts a given list to a map composed of its items.
 * @param list - list to convert
 * @param identifier - list item type identifier - either a number or string
 */
export function toMap<T, K extends keyof T>(
    list: T[],
    identifier: K,
): Map<IdentifierType<T, K>, T> {
    return list.filter(Boolean).reduce((acc, curr) => {
        acc.set(curr[identifier], curr);
        return acc;
    }, new Map());
}
