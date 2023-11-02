import { BaseFindDto } from "../base-find.dto";
import {
    PaginationResponseDto,
    TPaginationData,
} from "./pagination-response.dto";

/**
 * Builds pagination data from a 'paginable' data array and a DTO.
 * @param data
 * @param dto
 */
export default function buildPaginationResponse<T>(
    data: TPaginationData<T>,
    dto?: BaseFindDto<T>,
): PaginationResponseDto<T> {
    // Best-effort runtime check to ensure that data is an array with two elements.
    if (Array.isArray(data) && data.length === 2) {
        const [results, total] = data;
        const limit = dto?.offset || 20;
        const offset = dto?.limit || 0;

        let totalPages = 1;
        if (total > 0) {
            totalPages = Math.ceil(total / limit);
        }
        const hasNextPage = offset + limit < total;
        return {
            data: results,
            pagination: {
                total,
                totalPages,
                hasNextPage,
            },
        };
    } else {
        throw new Error("Invalid data to build pagination.");
    }
}
