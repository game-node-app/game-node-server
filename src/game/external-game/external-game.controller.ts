import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { parseRoles } from "../../auth/auth.service";
import { Session, SessionContainer } from "../../auth/session.decorator";
import { ExternalGameService } from "./external-game.service";
import { Roles } from "../../auth/roles.decorator";
import { EUserRoles } from "../../utils/constants";
import { SubmitExternalGameDto } from "./dto/submit-external-game.dto";
import {
    FindExternalGamesRequestDto,
    FindExternalGamesResponseDto,
} from "./dto/find-external-games.dto";
import {
    FindUnmappedExternalGamesRequestDto,
    FindUnmappedExternalGamesResponseDto,
} from "./dto/find-unmapped-external-games.dto";
import { PaginationInterceptor } from "../../interceptor/pagination.interceptor";
import { ApiOkResponse } from "@nestjs/swagger";
import {
    EPIC_NAMESPACE_FILL_JOB,
    EXTERNAL_GAME_MAPPING_QUEUE,
} from "./external-game-mapping.constants";

@Controller("game/external")
@UseGuards(AuthGuard)
export class ExternalGameController {
    constructor(
        private readonly externalGameService: ExternalGameService,
        @InjectQueue(EXTERNAL_GAME_MAPPING_QUEUE)
        private readonly mappingQueue: Queue,
    ) {}

    /**
     * Any signed-in user may look up exact category + store IDs (`category` with `uids`);
     * the unfiltered catalog listing stays limited to moderators and admins.
     */
    @Get()
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindExternalGamesResponseDto,
    })
    public async findAll(
        @Query() dto: FindExternalGamesRequestDto,
        @Session() session: SessionContainer,
    ) {
        if (dto.uids === undefined) {
            const roles = parseRoles(session.user.role);
            if (
                ![EUserRoles.MOD, EUserRoles.ADMIN].some((role) =>
                    roles.includes(role),
                )
            )
                throw new ForbiddenException();
        }
        return (await this.externalGameService.findAll(
            dto,
        )) as unknown as FindExternalGamesResponseDto;
    }

    @Get("unmapped")
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    @UseInterceptors(PaginationInterceptor)
    @ApiOkResponse({
        type: FindUnmappedExternalGamesResponseDto,
    })
    public async findUnmappedEntries(
        @Query() dto: FindUnmappedExternalGamesRequestDto,
    ) {
        return (await this.externalGameService.getUnmappedGames(
            dto,
        )) as unknown as FindUnmappedExternalGamesResponseDto;
    }

    @Post("unmapped/:id/dismiss")
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    public async dismissUnmappedEntry(@Param("id", ParseIntPipe) id: number) {
        return this.externalGameService.dismissUnmappedGame(id);
    }

    @Post()
    @Roles([EUserRoles.MOD, EUserRoles.ADMIN])
    public async submitExternalGame(@Body() dto: SubmitExternalGameDto) {
        return this.externalGameService.submit(dto);
    }

    /**
     * Starts the Epic namespace bulk fill. The fixed jobId makes BullMQ ignore a second
     * trigger while a run is queued or active, and the finished job is removed so the next run can start.
     */
    @Post("fill/epic")
    @Roles([EUserRoles.ADMIN])
    public async fillEpicNamespaces() {
        const job = await this.mappingQueue.add(
            EPIC_NAMESPACE_FILL_JOB,
            {},
            {
                jobId: EPIC_NAMESPACE_FILL_JOB,
                attempts: 3,
                backoff: { type: "exponential", delay: 60_000 },
                removeOnComplete: true,
                removeOnFail: true,
            },
        );
        return { jobId: job.id, state: await job.getState() };
    }
}
