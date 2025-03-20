import { Injectable, Logger } from "@nestjs/common";
import { UploadPostImageResponseDto } from "./dto/upload-post-image.dto";
import { FindManyOptions, FindOneOptions } from "typeorm";
import { Post } from "./entity/post.entity";
import { CreatePostDto } from "./dto/create-post.dto";
import { PostsRepository } from "./posts.repository";
import { GetPostsRequestDto } from "./dto/get-posts.dto";
import { UploadService } from "../upload/upload.service";

@Injectable()
export class PostsService {
    private readonly logger = new Logger(PostsService.name);

    constructor(
        private readonly postRepository: PostsRepository,
        private readonly uploadService: UploadService,
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

    public async create(userId: string, { content, gameId }: CreatePostDto) {
        const post = this.postRepository.create({
            profileUserId: userId,
            content,
            gameId,
        });

        return await this.postRepository.save(post);
    }

    public async uploadPostImage(
        userId: string,
        file: Express.Multer.File,
    ): Promise<UploadPostImageResponseDto> {
        const { fileNameWithExtension } = await this.uploadService.save(
            userId,
            file,
        );

        return {
            filename: fileNameWithExtension,
        };
    }

    public async delete(userId: string, postId: string) {
        await this.postRepository.softDelete({
            profileUserId: userId,
            id: postId,
        });
    }
}
