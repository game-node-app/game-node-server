import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
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
import { FollowInfoRequestDto } from "./dto/follow-info-request.dto";
import { PaginationInterceptor } from "../interceptor/pagination.interceptor";
import { FollowInfoResponseDto } from "./dto/follow-info-response.dto";
import { UserFollow } from "./entity/user-follow.entity";

@Controller("follow")
@ApiTags("follow")
@UseGuards(AuthGuard)
export class FollowController {
    constructor(private followService: FollowService) {}

    @Get("status")
    @ApiOkResponse({
        type: FollowStatusDto,
    })
    @Public()
    async getFollowerStatus(
        @Query("followerUserId") followerUserId: string,
        @Query("followedUserId") followedUserId: string,
    ) {
        return this.followService.getStatus(followerUserId, followedUserId);
    }

    @Get(":id")
    @ApiOkResponse({
        type: UserFollow,
    })
    async getUserFollowById(@Param("id") userFollowId: number) {
        return this.followService.findOneByIdOrFail(userFollowId);
    }

    @Post("info")
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FollowInfoResponseDto,
    })
    @Public()
    @HttpCode(HttpStatus.OK)
    async getFollowInfo(@Body() dto: FollowInfoRequestDto) {
        return await this.followService.getFollowerInfo(dto);
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
        return await this.followService.removeFollow(
            session.getUserId(),
            dto.followedUserId,
        );
    }
}
