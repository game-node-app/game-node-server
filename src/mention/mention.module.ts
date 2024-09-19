import { Module } from "@nestjs/common";
import { MentionService } from "./mention.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewMention } from "./entity/review-mention.entity";

@Module({
    imports: [TypeOrmModule.forFeature([ReviewMention])],
    providers: [MentionService],
    exports: [MentionService],
})
export class MentionModule {}
