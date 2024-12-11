/**
 * Checks if a given object is empty ({})
 * Note: this returns FALSE if 'obj' is null.
 * @param obj
 * @example
 * const obj1 = {}
 * isEmptyObject(obj1) // true
 *
 * const obj2 = null
 * isEmptyObject(obj2) // false
 */
export default function isEmptyObject(obj: any) {
    return JSON.stringify(obj) === "{}";
}
