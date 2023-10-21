import { Module } from "@nestjs/common";
import { GameSearchService } from "./game-search.service";
import { GameSearchController } from "./game-search.controller";

@Module({
    providers: [GameSearchService],
    controllers: [GameSearchController],
})
export class GameSearchModule {}
