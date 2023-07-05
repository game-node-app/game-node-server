import { FindIgdbDto } from "./find-igdb.dto";
declare const FindIgdbIdDto_base: import("@nestjs/common").Type<Omit<FindIgdbDto, "search" | "where">>;
export declare class FindIgdbIdDto extends FindIgdbIdDto_base {
    igdbIds: number[];
}
export {};
