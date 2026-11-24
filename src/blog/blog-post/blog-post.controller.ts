import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AuthGuard } from '../../auth/auth.guard';
import { Public } from '../../auth/public.decorator';
import { PaginationInterceptor } from '../../interceptor/pagination.interceptor';
import { BlogDeliveryService } from './blog-delivery.service';
import { BlogArticleDto, BlogListQueryDto, BlogListResponseDto, BlogLocaleQueryDto, BlogTagDto } from './dto/blog-content.dto';

@Controller('blog/post')
@UseGuards(AuthGuard)
export class BlogPostController {
    constructor(private readonly delivery: BlogDeliveryService) {}

    @Get('tags')
    @Public()
    @ApiOkResponse({ type: [BlogTagDto] })
    async tags(@Query() query: BlogLocaleQueryDto) {
        return this.delivery.tags(query.locale);
    }

    @Get(':postId')
    @Public()
    @ApiOkResponse({ type: BlogArticleDto })
    async one(@Param('postId') id: string, @Query() query: BlogLocaleQueryDto) {
        return this.delivery.one(id, query.locale);
    }

    @Get()
    @Public()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({ type: BlogListResponseDto })
    async list(@Query() query: BlogListQueryDto) {
        return this.delivery.list(query.locale, query.tag, query.offset, query.limit);
    }
}
