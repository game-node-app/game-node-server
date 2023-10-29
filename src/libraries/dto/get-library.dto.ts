import { BaseFindDto } from "../../utils/base-find.dto";
import { Library } from "../entities/library.entity";

export class GetLibraryDto extends BaseFindDto<Library> {}
