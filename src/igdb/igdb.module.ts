import { Module } from "@nestjs/common";
import { IgdbService } from "./igdb.service";
import { IgdbController } from "./igdb.controller";
import { HttpModule } from "@nestjs/axios";
import { IgdbAuthService } from "./igdb.auth.service";

@Module({
    imports: [HttpModule],
    controllers: [IgdbController],
    providers: [IgdbService, IgdbAuthService],
    exports: [IgdbService],
})
export class IgdbModule {}
