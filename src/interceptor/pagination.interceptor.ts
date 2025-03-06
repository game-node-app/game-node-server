import { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { map } from "rxjs";
import { BaseFindDto } from "../utils/base-find.dto";
import {
    PaginationResponseDto,
    TPaginationData,
} from "../utils/pagination/pagination-response.dto";
import { buildPaginationResponse } from "../utils/pagination/buildPaginationResponse";

/**
 * Interceptor that automatically builds pagination data based on results.<br>
 * This only affects requests that return a [T[], number] array. <br>
 * If another type of object is received, an error will be thrown. <br>
 * Keep in mind that decorators (and thereby interceptors) can't inspect the actual type of the object returned by the controller,
 * so Typescript won't know if it's being used on the wrong data type.
 */
export class PaginationInterceptor<T>
    implements
        NestInterceptor<
            TPaginationData<T>,
            PaginationResponseDto<T> | TPaginationData<T>
        >
{
    /**
     * Builds a simplified DTO for pagination data based on query params.
     * The actual DTO received by the controller is not available in this context.
     * @param requestObject
     * @private
     */
    private buildSimplifiedDto(requestObject: any): BaseFindDto<T> {
        let { offset, limit } = requestObject;
        if (offset == undefined || offset === "") {
            offset = 0;
        } else {
            offset = parseInt(offset, 10);
        }
        if (limit == undefined || limit === "") {
            limit = 10;
        } else {
            limit = parseInt(limit, 10);
        }
        return {
            offset: Number.isNaN(offset) ? undefined : offset,
            limit: Number.isNaN(limit) ? undefined : limit,
        };
    }

    intercept(
        context: ExecutionContext,
        next: CallHandler<TPaginationData<T>>,
    ) {
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
                return buildPaginationResponse<T>(data, simplifiedDto);
            }),
        );
    }
}
