import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from "@nestjs/common";
import { map, Observable } from "rxjs";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { Statistics } from "./entity/statistics.entity";
import { resolveSourceIdsTypes } from "./statistics.utils";

/**
 * Interceptor that converts statistics responses' source ids to valid values (e.g. a game source id to number).
 * <br>
 * <strong>Important</strong>: This should be called BEFORE PaginationInterceptor. <br>
 * Only affects routes which return an tuple of two items (TPaginationData) or an array of Statistics (Statistics[])
 */
@Injectable()
export class StatisticsInterceptor
    implements NestInterceptor<TPaginationData<Statistics>>
{
    private hasStatistics(data: any[]): data is Statistics[] {
        return data.some(
            (possibleStatistics) => possibleStatistics instanceof Statistics,
        );
    }

    intercept(
        context: ExecutionContext,
        next: CallHandler<TPaginationData<Statistics>>,
    ): Observable<TPaginationData<Statistics> | Statistics[]> {
        return next.handle().pipe(
            map((data) => {
                if (
                    Array.isArray(data) &&
                    data[1] != undefined &&
                    typeof data[1] === "number"
                ) {
                    const [statistics, count] = data;
                    return [resolveSourceIdsTypes(statistics), count];
                } else if (Array.isArray(data)) {
                    if (this.hasStatistics(data)) {
                        return resolveSourceIdsTypes(data);
                    }
                }
                return data;
            }),
        );
    }
}
