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
        gameId,
        profileUserId,
        limit = 20,
    }: GetPostsRequestDto) {
        const qb = this.createQueryBuilder("p")
            .orderBy("p.createdAt", "DESC")
            .addOrderBy("p.id", "DESC") // Tie-breaker
            .limit(limit);

        if (gameId) {
            qb.andWhere("p.gameId = :gameId", { gameId });
        }

        if (profileUserId) {
            qb.andWhere("p.profileUserId = :profileUserId", { profileUserId });
        }

        if (lastCreatedAt && lastId) {
            qb.andWhere("(p.createdAt, p.id) < (:lastCreatedAt, :lastId)", {
                lastCreatedAt,
                lastId,
            });
        }

        return qb.getManyAndCount();
    }
}
