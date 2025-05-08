import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";
import { ImporterResponseItemDto } from "./importer-response-item.dto";

export class ImporterPaginatedResponseDto {
    data: ImporterResponseItemDto[];
    pagination: PaginationInfo;
}
