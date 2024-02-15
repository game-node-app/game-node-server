import { PartialType } from "@nestjs/swagger";
import { CreateUserLevelDto } from "./create-user-level.dto";

export class UpdateUserLevelDto extends PartialType(CreateUserLevelDto) {}
