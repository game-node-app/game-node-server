import { Report } from "../entity/report.entity";
import { PaginationInfo } from "../../utils/pagination/pagination-response.dto";

export class PaginatedReportResponseDto {
    data: Report[];
    pagination: PaginationInfo;
}
