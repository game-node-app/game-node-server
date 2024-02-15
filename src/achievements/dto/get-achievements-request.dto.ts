import { BaseFindDto } from "../../utils/base-find.dto";
import { Achievement } from "../models/achievement.model";
import { PickType } from "@nestjs/swagger";

export class GetAchievementsRequestDto extends PickType(
    BaseFindDto<Achievement>,
    ["offset", "limit"],
) {}
