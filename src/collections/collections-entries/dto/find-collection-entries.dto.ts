import { CollectionEntry } from "../entities/collection-entry.entity";
import { BaseFindDto } from "../../../utils/base-find.dto";
import { OmitType, PickType } from "@nestjs/swagger";
import { FindCollectionEntriesOrderBy } from "./collection-entries-order-by.dto";
import { IsOptional, IsString } from "class-validator";
import { CollectionEntryStatus } from "../collections-entries.constants";
import { Expose, Transform } from "class-transformer";
import qs from "qs";
import { GameRepositoryFilterDto } from "../../../game/game-repository/dto/game-repository-filter.dto";

export class FindCollectionEntriesGameFilterDto extends PickType(
    GameRepositoryFilterDto,
    ["category", "status"],
) {}

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
    gameFilters?: FindCollectionEntriesGameFilterDto;
}
