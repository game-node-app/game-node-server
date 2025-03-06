import { EntityManager, Repository } from "typeorm";
import { Post } from "./entity/post.entity";
import { Injectable } from "@nestjs/common";
import { GetPostsRequestDto } from "./dto/get-posts.dto";

@Injectable()
export class PostsRepository extends Repository<Post> {
    constructor(readonly em: EntityManager) {
        super(Post, em);
    }

    /**
     * Cursor based pagination for posts.
     * @param cursor
     * @param gameId
     * @param profileUserId
     * @param limit
     */
    public async findAllPaginated({
        lastCreatedAt,
        lastId,
        postId,
        gameId,
        profileUserId,
        limit = 20,
    }: GetPostsRequestDto) {
        const qb = this.createQueryBuilder("p").limit(limit);

        if (gameId) {
            qb.andWhere("p.gameId = :gameId");
        }

        if (profileUserId) {
            qb.andWhere("p.profileUserId = :profileUserId");
        }

        if (lastCreatedAt && lastId) {
            qb.andWhere("(p.createdAt, p.id) < (:lastCreatedAt, :lastId)");
        }

        if (postId) {
            qb.orderBy(`CASE WHEN p.id = :postId THEN 0 ELSE 1 END`, "ASC")
                .addOrderBy("p.createdAt", "DESC")
                .addOrderBy("p.id", "DESC"); // Tie-breaker
        } else {
            qb.orderBy("p.createdAt", "DESC").addOrderBy("p.id", "DESC"); // Tie-breaker
        }

        qb.setParameters({
            postId,
            lastCreatedAt,
            lastId,
            profileUserId,
            gameId,
        });

        return qb.getManyAndCount();
    }
}
