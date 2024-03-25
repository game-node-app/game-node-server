import { Module } from "@nestjs/common";
import { JwtAuthService } from "./jwt-auth.service";

@Module({
    providers: [JwtAuthService],
    exports: [JwtAuthService],
})
export class JwtAuthModule {}
