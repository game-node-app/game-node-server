import { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";
import buildPaginationResponse, {
    TPaginationData,
    TPaginationResponse,
} from "../utils/buildPaginationResponse";
import { BaseFindDto } from "../utils/base-find.dto";

/**
 * Interceptor that automatically builds pagination data based on results.<br>
 * This only affects requests that return a TPaginationData<T> = [T[], number] array. <br>
 * If another type of object is received, it will be passed through without any changes. <br>
 */
export class PaginationInterceptor<T>
    implements NestInterceptor<TPaginationData<T>, TPaginationResponse<T>>
{
    /**
     * Builds a simplified DTO for pagination data based on query params.
     * The actual DTO received by the controller is not available here.
     * @param request
     * @private
     */
    private buildSimplifiedDto(request: any): BaseFindDto {
        let { offset, limit } = request.query;
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
    ):
        | Observable<TPaginationResponse<T>>
        | Promise<Observable<TPaginationResponse<T>>> {
        const request = context.switchToHttp().getRequest();
        const simplifiedDto = this.buildSimplifiedDto(request);
        return next.handle().pipe(
            map((data) => {
                if (data instanceof Array) {
                    return buildPaginationResponse<T>(data, simplifiedDto);
                }
                return data;
            }),
        );
    }
}
