import { Controller } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

@Controller("auth")
@ApiTags("auth")
export class AuthController {}
