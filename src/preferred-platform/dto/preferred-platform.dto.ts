import { OmitType } from "@nestjs/swagger";
import { PreferredPlatform } from "../entity/preferred-platform.entity";

export class PreferredPlatformDto extends OmitType(PreferredPlatform, [
    "library",
]) {}
