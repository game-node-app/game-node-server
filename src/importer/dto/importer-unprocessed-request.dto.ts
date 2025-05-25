import { BaseFindDto } from "../../utils/base-find.dto";
import { PickType } from "@nestjs/swagger";

export class ImporterUnprocessedRequestDto extends PickType(BaseFindDto<any>, [
    "limit",
    "offset",
    "search",
]) {}
