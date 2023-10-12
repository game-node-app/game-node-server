import { Controller, Get, UseGuards } from "@nestjs/common";
import { AppService } from "./app.service";
import { AuthGuard } from "./auth/auth.guard";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "./auth/session.decorator";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";

@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get()
    getHello(): string {
        return this.appService.getHello();
    }

    @Get("test")
    @UseGuards(new JwtAuthGuard())
    async getTest(): Promise<string> {
        // TODO: magic
        return "magic";
    }
}
