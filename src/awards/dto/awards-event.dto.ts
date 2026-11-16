import { OmitType } from "@nestjs/swagger";
import { AwardsEvent } from "../entity/awards-event.entity";
import { AwardsPhase } from "../awards.utils";

export class AwardsEventDto extends OmitType(AwardsEvent, ["categories"]) {
    phase: AwardsPhase;
}

export class CurrentAwardsEventDto extends AwardsEventDto {
    categoriesCount: number;
}
