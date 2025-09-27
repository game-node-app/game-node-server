import { OmitType } from "@nestjs/swagger";
import { AwardsCategory } from "../entity/awards-category.entity";

export class VotableAwardsCategoryDto extends OmitType(AwardsCategory, [
    "event",
]) {
    isVotable: boolean;
    votingStartDate: Date;
    votingEndDate: Date;
}
