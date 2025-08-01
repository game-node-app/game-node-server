import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CreateUpdateBlogPostDto } from "./dto/create-update-blog-post.dto";
import { FindOptionsRelations, Repository } from "typeorm";
import { BlogPost } from "./entity/blog-post.entity";
import { BlogPostTag } from "./entity/blog-post-tag.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { UploadService } from "../../upload/upload.service";
import { BlogPostImage } from "./entity/blog-post-image.entity";
import { FindAllBlogPostRequestDto } from "./dto/find-blog-post.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { EUserRoles } from "../../utils/constants";
import { checkUserHasRole } from "../../utils/checkUserHasRole";
import { BlogPostReview } from "./entity/blog-post-review.entity";

@Injectable()
export class BlogPostService {
    private readonly relations: FindOptionsRelations<BlogPost> = {
        image: true,
        review: true,
        tags: true,
    };

    constructor(
        @InjectRepository(BlogPost)
        private readonly blogPostRepository: Repository<BlogPost>,
        @InjectRepository(BlogPostTag)
        private readonly blogPostTagRepository: Repository<BlogPostTag>,
        @InjectRepository(BlogPostImage)
        private readonly blogPostImageRepository: Repository<BlogPostImage>,
        @InjectRepository(BlogPostReview)
        private readonly blogPostReviewRepository: Repository<BlogPostReview>,
        private readonly uploadService: UploadService,
    ) {}

    public async findOneOrFail(userId: string | undefined, postId: string) {
        const post = await this.blogPostRepository.findOneOrFail({
            where: {
                id: postId,
            },
            relations: this.relations,
        });

        if (post.isDraft) {
            if (userId) {
                const hasPermission = await checkUserHasRole(userId, [
                    EUserRoles.ADMIN,
                    EUserRoles.MOD,
                    EUserRoles.EDITOR,
                ]);
                if (hasPermission) {
                    return post;
                }
            }

            throw new HttpException(
                "This post is a draft and can't be viewed yet.",
                HttpStatus.FORBIDDEN,
            );
        }

        return post;
    }

    private async processTags(tags: string[]) {
        const blogPostTags = tags.map((tag) => {
            const tagIdentifier = tag.toLowerCase();
            return this.blogPostTagRepository.create({
                id: tagIdentifier,
                name: tagIdentifier,
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

    private async validateCreateUpdate(
        userId: string,
        dto: CreateUpdateBlogPostDto,
        image: Express.Multer.File | undefined,
    ) {
        const hasReviewTag = dto.tags.some(
            (tag) => tag.toLowerCase() === "review",
        );

        if (dto.reviewInfo != undefined && !hasReviewTag) {
            throw new HttpException(
                "Reviews must have a review tag set.",
                HttpStatus.BAD_REQUEST,
            );
        }

        if (dto.reviewInfo == undefined && hasReviewTag) {
            throw new HttpException(
                "Reviews must have review info set.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const existingPost = await this.blogPostRepository.findOneBy({
            id: dto.postId,
        });

        if (existingPost == undefined && image == undefined && !dto.isDraft) {
            throw new HttpException(
                "A post must have an associated image.",
                HttpStatus.BAD_REQUEST,
            );
        }

        if (existingPost != undefined && existingPost.profileUserId != userId) {
            const hasEditPermission = checkUserHasRole(userId, [
                EUserRoles.ADMIN,
            ]);
            if (!hasEditPermission) {
                throw new HttpException(
                    "User doesn't have permission to edit a non-authored post.",
                    HttpStatus.FORBIDDEN,
                );
            }
        }
    }

    public async createOrUpdate(
        userId: string,
        dto: Omit<CreateUpdateBlogPostDto, "image">,
        image: Express.Multer.File | undefined,
    ) {
        await this.validateCreateUpdate(userId, dto, image);

        let existingPost: BlogPost | undefined;
        /**
         * Avoids an issue where 'dto.postId' is undefined and the last*
         * blog post is fetched, and the wrong author is used.
         */
        if (dto.postId) {
            existingPost = await this.blogPostRepository.findOneByOrFail({
                id: dto.postId,
            });
        }

        const tags = await this.processTags(dto.tags);
        let postImage: BlogPostImage | undefined;
        if (image) {
            postImage = await this.processImage(userId, image);
        }

        const result = await this.blogPostRepository.save({
            id: dto.postId,
            title: dto.title,
            isDraft: dto.isDraft,
            profileUserId: existingPost ? existingPost.profileUserId : userId,
            image: postImage,
            tags: tags,
            content: dto.content,
        });

        await this.blogPostReviewRepository.delete({
            postId: result.id,
        });

        if (dto.reviewInfo) {
            await this.blogPostReviewRepository.save({
                postId: result.id,
                gameId: dto.reviewInfo.gameId,
                rating: dto.reviewInfo.rating,
            });
        }

        return result.id;
    }

    public async updatePostImage(
        userId: string,
        postId: string,
        image: Express.Multer.File,
    ) {
        const postImage = await this.processImage(userId, image);

        await this.blogPostRepository.update(
            {
                id: postId,
            },
            {
                image: postImage,
            },
        );
    }

    public async findAll(
        userId: string | undefined,
        dto: FindAllBlogPostRequestDto,
    ) {
        if (dto.includeDraft) {
            if (!userId) {
                throw new HttpException(
                    "User lacks permission to this resource.",
                    HttpStatus.FORBIDDEN,
                );
            }
            const hasPermission = await checkUserHasRole(userId, [
                EUserRoles.ADMIN,
                EUserRoles.MOD,
                EUserRoles.EDITOR,
            ]);

            if (!hasPermission) {
                throw new HttpException(
                    "User lacks permission to this resource.",
                    HttpStatus.FORBIDDEN,
                );
            }
        }

        const baseOptions = buildBaseFindOptions<BlogPost>(dto);

        return this.blogPostRepository.findAndCount({
            ...baseOptions,
            where: {
                isDraft: dto.includeDraft ? undefined : false,
                tags: dto.tag
                    ? {
                          id: dto.tag.toLowerCase(),
                      }
                    : undefined,
            },
            relations: this.relations,
            order: {
                createdAt: "DESC",
            },
        });
    }

    public async findAllTags() {
        return this.blogPostTagRepository.find();
    }

    async delete(postId: string) {
        await this.blogPostRepository.softRemove({
            id: postId,
        });
    }
}
