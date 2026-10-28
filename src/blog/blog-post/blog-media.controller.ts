import { Controller, Get, NotFoundException, Param, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { resolve } from 'node:path';
import { AuthGuard } from '../../auth/auth.guard';
import { Public } from '../../auth/public.decorator';

@Controller('blog/media')
@UseGuards(AuthGuard)
export class BlogMediaController {
    @Get(':name')
    @Public()
    media(@Param('name') name: string, @Res() response: Response) {
        if (!/^[a-f0-9]{64}\.webp$/.test(name)) throw new NotFoundException();
        const root = process.env.BLOG_PUBLIC_MEDIA_PATH;
        if (!root) throw new ServiceUnavailableException('Blog media is not configured');
        response.type('image/webp');
        response.sendFile(name, { root: resolve(root) }, (error) => {
            if (error && !response.headersSent) response.status(404).end();
            else if (error) response.destroy(error);
        });
    }
}
