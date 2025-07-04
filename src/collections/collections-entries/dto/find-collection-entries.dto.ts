import { CollectionEntry } from "../entities/collection-entry.entity";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { OmitType } from "@nestjs/swagger";
import { FindCollectionEntriesOrderBy } from "./collection-entries-order-by.dto";
import { IsOptional, IsString } from "class-validator";
import { CollectionEntryStatus } from "../collections-entries.constants";
import { Expose, Transform } from "class-transformer";
import qs from "qs";
import { EGameCategory } from "../../../game/game-repository/game-repository.constants";

export class FindCollectionEntriesDto extends OmitType(
    BaseFindDto<CollectionEntry>,
    ["search", "orderBy"],
) {
    @IsOptional()
    // Forces orderBy's Transform to run
    @Expose({ name: "orderBy" })
    // This extra logic makes the orderBy work for GET request parameters
    @Transform(({ obj }) => {
        const rawQueryString = qs.stringify(obj);
        const parsed = qs.parse(rawQueryString);

        return parsed.orderBy;
    })
    orderBy?: FindCollectionEntriesOrderBy;
    @IsOptional()
    @IsString()
    status?: CollectionEntryStatus;
    @IsOptional()
    category: EGameCategory[] = [];
}
