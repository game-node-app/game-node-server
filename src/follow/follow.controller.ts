import {
    Body,
    Controller,
    Delete,
    Get,
    Post,
    Query,
    UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { FollowService } from "./follow.service";
import { FollowRegisterDto } from "./dto/follow-register.dto";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { FollowStatusDto } from "./dto/follow-status.dto";
import { FollowRemoveDto } from "./dto/follow-remove.dto";
import { Public } from "../auth/public.decorator";

@Controller("follow")
@ApiTags("follow")
@UseGuards(AuthGuard)
export class FollowController {
    constructor(private followService: FollowService) {}

    @Get("status")
    @ApiOkResponse({
        status: 200,
        type: FollowStatusDto,
    })
    @Public()
    async getFollowerStatus(
        @Query("followerUserId") followerUserId: string,
        @Query("followedUserId") followedUserId: string,
    ) {
        return this.followService.getStatus(followerUserId, followedUserId);
    }

    @Get("count")
    @Public()
    async getFollowersCount(@Query("targetUserId") targetUserId: string) {
        return await this.followService.getFollowersCount(targetUserId);
    }

    @Post()
    async registerFollow(
        @Session() session: SessionContainer,
        @Body() dto: FollowRegisterDto,
    ) {
        return await this.followService.registerFollow(
            session.getUserId(),
            dto.followedUserId,
        );
    }

    @Delete()
    async removeFollow(
        @Session() session: SessionContainer,
        @Body() dto: FollowRemoveDto,
    ) {
        return await this.followService.removeFollow(session.getUserId(), dto);
    }
}
