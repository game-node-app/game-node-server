import { IsEnum } from "class-validator";
import { LibraryVisibility } from "../../../libraries/library-visibility.constants";

export class CollectionEntryVisibilityDto {
    @IsEnum(LibraryVisibility)
    visibility: LibraryVisibility;
}
