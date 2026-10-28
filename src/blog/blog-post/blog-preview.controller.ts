import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ApiOkResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { EUserRoles } from '../../utils/constants';
import { BlogDeliveryService } from './blog-delivery.service';
import { BlogPresentationService } from './blog-presentation.service';
import { BlogPreviewDto, BlogPreviewQueryDto } from './dto/blog-content.dto';

const { mediaReference } = require('./blog-media.cjs') as { mediaReference: (source: string, url: string) => { id: string; query: string } | null };

@Controller('blog/preview')
@UseGuards(AuthGuard)
export class BlogPreviewController {
    constructor(private readonly delivery: BlogDeliveryService, private readonly presentation: BlogPresentationService, private readonly http: HttpService) {}

    @Get('media/:id')
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    async media(@Param('id') id: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
        response.setHeader('Cache-Control', 'private, no-store');
        const base = process.env.BLOG_CMS_URL;
        const token = process.env.BLOG_CMS_PREVIEW_TOKEN;
        if (!base || !token) throw new ServiceUnavailableException('Blog CMS is not configured');
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            if (typeof value !== 'string') throw new BadRequestException('Invalid image transformation');
            params.append(key, value);
        }
        let ref: { id: string; query: string } | null;
        try { ref = mediaReference(`/assets/${id}?${params}`, base); }
        catch { throw new BadRequestException('Invalid image reference'); }
        if (!ref) throw new NotFoundException();
        try {
            const upstream = await this.http.axiosRef.get(`${base.replace(/\/$/, '')}/assets/${ref.id}?${ref.query}`, {
                headers: { Authorization: `Bearer ${token}` }, responseType: 'stream', timeout: 5000, maxRedirects: 0,
            });
            if (!String(upstream.headers['content-type']).startsWith('image/webp')) { upstream.data.destroy(); throw new Error('Invalid media type'); }
            response.setHeader('Content-Type', 'image/webp');
            upstream.data.on('error', () => response.destroy());
            upstream.data.pipe(response);
        } catch { throw new ServiceUnavailableException('Blog media is unavailable'); }
    }

    @Get(':postId')
    @Roles([EUserRoles.ADMIN, EUserRoles.MOD, EUserRoles.EDITOR])
    @ApiOkResponse({ type: BlogPreviewDto })
    async preview(@Param('postId') id: string, @Query() query: BlogPreviewQueryDto, @Res({ passthrough: true }) response: Response) {
        response.setHeader('Cache-Control', 'private, no-store');
        const row = await this.delivery.preview(id, query.locale);
        return this.presentation.present(row.article, row.translation, query.locale, row.availableLocales, true);
    }
}
