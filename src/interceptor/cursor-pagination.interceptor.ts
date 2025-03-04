import { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";
import { buildCursorPaginationResponse } from "../utils/pagination/buildPaginationResponse";
import {
    PaginationResponseDto,
    TPaginationData,
} from "../utils/pagination/pagination-response.dto";
import { BaseCursorFindDto } from "../utils/base-cursor-find.dto";

/**
 * Cursor based implementation of {@link PaginationInterceptor} to handle cursor-based queries
 * e.g.: Queries that include a "lastCreatedAt" and "id" fields.
 * @see PostsRepository#findAllPaginated
 */
export class CursorPaginationInterceptor<T>
    implements
        NestInterceptor<
            TPaginationData<T>,
            PaginationResponseDto<T> | TPaginationData<T>
        >
{
    /**
     * Builds a simplified DTO for pagination data based on query params.
     * @param requestObject
     * @private
     */
    private buildSimplifiedDto(requestObject: any): BaseCursorFindDto {
        let { limit } = requestObject;
        const { lastCreatedAt, lastId } = requestObject;

        if (limit == undefined || limit === "") {
            limit = 10; // Default limit
        } else {
            limit = parseInt(limit, 10);
        }

        return {
            limit: Number.isNaN(limit) ? undefined : limit,
            lastCreatedAt: lastCreatedAt || undefined,
            lastId: lastId || undefined,
        };
    }

    intercept(
        context: ExecutionContext,
        next: CallHandler<TPaginationData<T>>,
    ): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const method = request.method;
        const requestObject = method === "GET" ? request.query : request.body;

        const simplifiedDto = this.buildSimplifiedDto(requestObject);

        return next.handle().pipe(
            map((data) => {
                if (!["GET", "POST"].includes(method)) {
                    // Does nothing for non GET and POST methods
                    return data;
                }
                const response = buildCursorPaginationResponse<T>(
                    data,
                    simplifiedDto,
                );
                return response;
            }),
        );
    }
}
