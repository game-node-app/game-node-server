import { BaseFindDto } from "../../utils/base-find.dto";
import { Notification } from "../entity/notification.entity";
import { OmitType } from "@nestjs/swagger";

export class FindNotificationsDto extends OmitType(BaseFindDto<Notification>, [
    "search",
    "orderBy",
]) {}
