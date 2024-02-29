import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { FollowService } from "./follow.service";
import { FollowRegisterDto } from "./dto/follow-register.dto";
import { SessionContainer } from "supertokens-node/recipe/session";
import { Session } from "../auth/session.decorator";
import { ApiOkResponse } from "@nestjs/swagger";
import { FollowStatusDto } from "./dto/follow-status.dto";

@Controller("follow")
@UseGuards(AuthGuard)
export class FollowController {
    constructor(private followService: FollowService) {}

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

    @Get("status")
    @ApiOkResponse({
        status: 200,
        type: FollowStatusDto,
    })
    async getFollowerStatus(
        @Session() session: SessionContainer,
        @Query("followedUserId") followedUserId: string,
    ) {
        return this.followService.getStatus(
            session.getUserId(),
            followedUserId,
        );
    }
}
