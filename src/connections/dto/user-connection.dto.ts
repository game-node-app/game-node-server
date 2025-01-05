import { UserConnection } from "../entity/user-connection.entity";
import { OmitType } from "@nestjs/swagger";

export class UserConnectionDto extends OmitType(UserConnection, ["profile"]) {
    isImporterViable: boolean;
    isImporterWatchViable: boolean;
}
