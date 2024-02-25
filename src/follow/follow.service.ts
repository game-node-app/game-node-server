import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { Repository } from "typeorm";

@Injectable()
export class FollowService {
    constructor(
        @InjectRepository(UserFollow)
        private userFollowRepository: Repository<UserFollow>,
    ) {}

    public async registerFollow(
        followingUserId: string,
        followedUserId: string,
    ) {
        try {
            await this.userFollowRepository.save({});
        } catch (e) {}
    }
}
