import { TPaginationData } from "./pagination-response.dto";

/**
 * Simply 'transforms' a list into valid data that can be used by the PaginationInterceptor.
 * Treats the list as empty ([]) if it's undefined.
 * @param list
 * @param offset
 * @param limit
 */
export function listToPaginationData<T>(list: T[]): TPaginationData<T> {
    if (list == undefined || list.length == undefined) {
        return [[], 0];
    }
    const totalItems = list.length;
    return [list, totalItems];
}
