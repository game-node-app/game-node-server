import { Injectable } from "@nestjs/common";
import { CreateBlogPostDto } from "./dto/create-blog-post.dto";
import { In, Repository } from "typeorm";
import { BlogPost } from "./entity/blog-post.entity";
import { BlogPostTag } from "./entity/blog-post-tag.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { UploadService } from "../../upload/upload.service";
import { BlogPostImage } from "./entity/blog-post-image.entity";
import { FindAllBlogPostRequestDto } from "./dto/find-blog-post.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

@Injectable()
export class BlogPostService {
    constructor(
        @InjectRepository(BlogPost)
        private readonly blogPostRepository: Repository<BlogPost>,
        @InjectRepository(BlogPostTag)
        private readonly blogPostTagRepository: Repository<BlogPostTag>,
        @InjectRepository(BlogPostImage)
        private readonly blogPostImageRepository: Repository<BlogPostImage>,
        private readonly uploadService: UploadService,
    ) {}

    private async processTags(tags: string[]) {
        const blogPostTags = tags.map((tag) => {
            return this.blogPostTagRepository.create({
                id: tag.toLowerCase(),
                name: tag[0].toUpperCase() + tag.slice(1),
            });
        });

        return await this.blogPostTagRepository.save(blogPostTags);
    }

    private async processImage(userId: string, image: Express.Multer.File) {
        const { fileName, fileExt } = await this.uploadService.save(
            userId,
            image,
        );

        return await this.blogPostImageRepository.save({
            encoding: image.encoding,
            filename: fileName,
            mimetype: image.mimetype,
            extension: fileExt,
            size: image.size,
        });
    }

    public async create(
        userId: string,
        dto: Omit<CreateBlogPostDto, "image">,
        image: Express.Multer.File | undefined,
    ) {
        const tags = await this.processTags(dto.tags);
        let imageFilename: BlogPostImage | undefined;
        if (image) {
            imageFilename = await this.processImage(userId, image);
        }

        await this.blogPostRepository.insert({
            profileUserId: userId,
            image: imageFilename,
            tags: tags,
            content: dto.content,
        });
    }

    public async findAllDrafts(dto: FindAllBlogPostRequestDto) {
        const baseOptions = buildBaseFindOptions<BlogPost>(dto);

        return this.blogPostRepository.find({
            ...baseOptions,
            where: {
                isDraft: true,
                tags: dto.tag
                    ? {
                          id: dto.tag.toLowerCase(),
                      }
                    : undefined,
            },
            relations: ["tags", "image"],
            order: {
                createdAt: "DESC",
            },
        });
    }

    public async findAll(dto: FindAllBlogPostRequestDto) {
        const baseOptions = buildBaseFindOptions<BlogPost>(dto);

        return this.blogPostRepository.find({
            ...baseOptions,
            where: {
                isDraft: false,
                tags: dto.tag
                    ? {
                          id: dto.tag.toLowerCase(),
                      }
                    : undefined,
            },
            relations: ["tags", "image"],
            order: {
                createdAt: "DESC",
            },
        });
    }
}
