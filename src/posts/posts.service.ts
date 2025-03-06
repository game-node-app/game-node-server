import { HttpException, Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import mimetype from "mime-types";
import { UploadPostImageResponseDto } from "./dto/upload-post-image.dto";
import { getPersistedImagePath } from "../utils/getPersistedImagePath";
import { FindManyOptions, FindOneOptions, Repository } from "typeorm";
import { PostImage } from "./entity/post-image.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Post } from "./entity/post.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { PostsRepository } from "./posts.repository";
import { GetPostsRequestDto } from "./dto/get-posts.dto";

@Injectable()
export class PostsService {
    private readonly logger = new Logger(PostsService.name);

    constructor(
        private readonly postRepository: PostsRepository,
        @InjectRepository(PostImage)
        private readonly postImageRepository: Repository<PostImage>,
    ) {}

    public async findAll(options: FindManyOptions<Post>) {
        return this.postRepository.findAndCount(options);
    }

    public async findAllPaginated(dto: GetPostsRequestDto) {
        return this.postRepository.findAllPaginated(dto);
    }

    public async findOne(options: FindOneOptions<Post>) {
        return this.postRepository.findOne(options);
    }

    public async findOneById(id: string) {
        return this.postRepository.findOneBy({
            id,
        });
    }

    public async findOneByIdOrFail(id: string) {
        return this.postRepository.findOneByOrFail({
            id,
        });
    }

    public async create(
        userId: string,
        { content, associatedImageIds, gameId }: CreatePostDto,
    ) {
        const post = this.postRepository.create({
            profileUserId: userId,
            content,
            gameId,
        });

        const persistedPost = await this.postRepository.save(post);

        await this.associatePostImages(persistedPost.id, associatedImageIds);

        return persistedPost;
    }

    private async associatePostImages(postId: string, imageIds: number[]) {
        for (const imageId of imageIds) {
            await this.postImageRepository.update(imageId, {
                postId,
            });
        }
    }

    public async uploadPostImage(
        userId: string,
        file: Express.Multer.File,
    ): Promise<UploadPostImageResponseDto> {
        const fileName = crypto.randomBytes(16).toString("hex");
        const fileExt = mimetype.extension(file.mimetype) || "jpeg";
        const imagePath = getPersistedImagePath(fileName, fileExt);

        try {
            await fs.writeFile(imagePath, file.buffer);
        } catch (e) {
            this.logger.error(e);
            throw new HttpException("Error saving profile image.", 500);
        }

        const persistedImage = await this.postImageRepository.save({
            profileUserId: userId,
            encoding: file.encoding,
            filename: fileName,
            mimetype: file.mimetype,
            extension: fileExt,
            size: file.size,
        });

        return {
            filename: `${fileName}.${fileExt}`,
            id: persistedImage.id,
        };
    }

    public async delete(userId: string, postId: string) {
        await this.postRepository.softDelete({
            profileUserId: userId,
            id: postId,
        });
    }
}
