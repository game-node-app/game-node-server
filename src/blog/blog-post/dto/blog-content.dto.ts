import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { BlogLocale } from '../blog-selection';
import { PaginationInfo } from '../../../utils/pagination/pagination-response.dto';

export class BlogLocaleQueryDto {
    @ApiPropertyOptional({ enum: ['en', 'pt-BR'], default: 'en' })
    @IsOptional()
    @IsIn(['en', 'pt-BR'])
    locale: BlogLocale = 'en';
}

export class BlogListQueryDto extends BlogLocaleQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    tag?: string;

    @ApiPropertyOptional({ type: Number, default: 10, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 10;

    @ApiPropertyOptional({ type: Number, default: 0, minimum: 0 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    offset = 0;
}

export class BlogPreviewQueryDto {
    @ApiProperty({ enum: ['en', 'pt-BR'] })
    @IsIn(['en', 'pt-BR'])
    locale: BlogLocale;
}

export class BlogTagDto {
    @ApiProperty() id: string;
    @ApiProperty() name: string;
}

export class BlogReviewDto {
    @ApiProperty() gameId: number;
    @ApiProperty() rating: number;
}

export class BlogCoverDto {
    @ApiProperty() url: string;
    @ApiProperty() alt: string;
}

export class BlogArticleDto {
    @ApiProperty() id: string;
    @ApiProperty() title: string;
    @ApiProperty() content: string;
    @ApiProperty() excerpt: string;
    @ApiProperty() profileUserId: string;
    @ApiProperty({ type: [BlogTagDto] }) tags: BlogTagDto[];
    @ApiProperty({ type: BlogReviewDto, nullable: true }) review: BlogReviewDto | null;
    @ApiProperty({ type: BlogCoverDto }) cover: BlogCoverDto;
    @ApiProperty() publishedAt: string;
    @ApiProperty({ enum: ['en', 'pt-BR'] }) requestedLocale: BlogLocale;
    @ApiProperty({ enum: ['en', 'pt-BR'] }) resolvedLocale: string;
    @ApiProperty({ enum: ['en', 'pt-BR'], isArray: true }) availableLocales: BlogLocale[];
}

export class BlogPreviewCoverDto {
    @ApiProperty() url: string;
    @ApiProperty({ nullable: true, type: String }) alt: string | null;
}

export class BlogPreviewDto extends OmitType(BlogArticleDto, ['title', 'excerpt', 'cover', 'publishedAt'] as const) {
    @ApiProperty({ nullable: true, type: String }) title: string | null;
    @ApiProperty({ nullable: true, type: String }) excerpt: string | null;
    @ApiProperty({ type: BlogPreviewCoverDto, nullable: true }) cover: BlogPreviewCoverDto | null;
    @ApiProperty({ nullable: true, type: String }) publishedAt: string | null;
    @ApiProperty({ enum: ['draft', 'published'] }) status: string;
}

export class BlogListResponseDto {
    @ApiProperty({ type: [BlogArticleDto] }) data: BlogArticleDto[];
    @ApiProperty({ type: PaginationInfo }) pagination: PaginationInfo;
}
