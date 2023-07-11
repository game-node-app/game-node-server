import { OmitType, PickType } from "@nestjs/swagger";
import { FindIgdbDto } from "./find-igdb.dto";

export class FindIgdbIdDto extends OmitType(FindIgdbDto, ["search", "where"]) {
    igdbIds: number[];
}
