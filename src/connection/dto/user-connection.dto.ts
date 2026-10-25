import { UserConnection } from "../entity/user-connection.entity";
import { OmitType } from "@nestjs/swagger";
import { EConnectionAuthStatus } from "../connections.constants";

export class UserConnectionDto extends OmitType(UserConnection, [
    "profile",
    "credential",
] as const) {
    authStatus: EConnectionAuthStatus;
    isImporterViable: boolean;
    isImporterWatchViable: boolean;
    isPlaytimeImportViable: boolean;
    isAchievementImportViable: boolean;
}
