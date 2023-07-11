import { BaseFindDto } from "../../utils/base-find.dto";

export class FindPopularDto extends BaseFindDto {
    criteria: "likes" | "views" = "views";
}
