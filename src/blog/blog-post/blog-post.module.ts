import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { BlogCmsService } from './blog-cms.service';
import { BlogDeliveryService } from './blog-delivery.service';
import { BlogMediaController } from './blog-media.controller';
import { BlogPostController } from './blog-post.controller';
import { BlogPresentationService } from './blog-presentation.service';
import { BlogPreviewController } from './blog-preview.controller';

@Module({
    imports: [HttpModule],
    providers: [BlogCmsService, BlogDeliveryService, BlogPresentationService],
    controllers: [BlogPostController, BlogPreviewController, BlogMediaController],
})
export class BlogPostModule {}
