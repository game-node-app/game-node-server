import { HttpException, Injectable } from "@nestjs/common";
import { PostsService } from "../posts.service";
import { GetPostsFeedDto, PostsFeedCriteria } from "./dto/get-posts-feed.dto";
import { HttpStatusCode } from "axios";

@Injectable()
export class PostsFeedService {
    constructor(private readonly postsService: PostsService) {}

    // WIP
    private async buildAllFeed(dto: GetPostsFeedDto) {
        return this.postsService.findAllPaginated(dto);
    }

    public buildFeed(userId: string | undefined, dto: GetPostsFeedDto) {
        switch (dto.criteria) {
            case PostsFeedCriteria.ALL:
                return this.buildAllFeed(dto);
            default:
                throw new HttpException(
                    "Unsupported criteria.",
                    HttpStatusCode.BadRequest,
                );
        }
    }
}
