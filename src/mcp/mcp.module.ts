import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { CollectionsModule } from "../collections/collections.module";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { PostsModule } from "../posts/posts.module";
import { ExternalGameModule } from "../game/external-game/external-game.module";
import { McpController } from "./mcp.controller";
import { McpToolsService } from "./mcp-tools.service";

@Module({
    imports: [
        SearchModule,
        GameRepositoryModule,
        CollectionsModule,
        CollectionsEntriesModule,
        ReviewsModule,
        PostsModule,
        ExternalGameModule,
    ],
    controllers: [McpController],
    providers: [McpToolsService],
})
export class McpModule {}
