import { randomUUID } from "node:crypto";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DailyPracticeRound } from "./entity/daily-practice-round.entity";
import { DailyPoolService } from "./daily-pool.service";
import { DailyService } from "./daily.service";
import { DailyPlayRequestDto } from "./dto/daily-request.dto";
import { DailyPracticePlayResponseDto } from "./dto/daily-response.dto";
import { DailyEvaluation, assertProgressCanGrow } from "./daily-evaluator";
import {
    DailyMode,
    DailyStatus,
    practiceRoundsCutoff,
} from "./daily.constants";

/** Practice exists for the two modes that also have a daily competition. */
const PRACTICE_MODES: DailyMode[] = [DailyMode.COVER, DailyMode.SPECS];

@Injectable()
export class DailyPracticeService {
    constructor(
        @InjectRepository(DailyPracticeRound)
        private readonly roundRepository: Repository<DailyPracticeRound>,
        private readonly poolService: DailyPoolService,
        private readonly dailyService: DailyService,
    ) {}

    /** Starts a round with a random answer no reserved puzzle may hold. */
    async start(
        userId: string | undefined,
        mode: DailyMode,
    ): Promise<DailyPracticePlayResponseDto> {
        if (!PRACTICE_MODES.includes(mode))
            throw new BadRequestException(
                `Practice is only available in ${PRACTICE_MODES.join(" and ")}`,
            );
        const picked = await this.poolService.pickPractice(mode);
        if (!picked)
            throw new ServiceUnavailableException(
                "No practice answer available",
            );
        const round = await this.roundRepository.save({
            id: randomUUID(),
            userId: userId ?? null,
            mode,
            gameId: picked.gameId,
            meta: picked.meta,
            guesses: [],
            hintAt: null,
            status: DailyStatus.IN_PROGRESS,
            attempts: 0,
            finishedAt: null,
        });
        return this.toResponse(round, await this.evaluate(round), null);
    }

    /** Plays the round: a signed-in round only for its account, a guest round for its id. */
    async play(
        userId: string | undefined,
        roundId: string,
        dto: DailyPlayRequestDto,
    ): Promise<DailyPracticePlayResponseDto> {
        const round = await this.roundRepository.findOneBy({ id: roundId });
        // Missing, or past its lifetime when a cleanup run was missed.
        if (!round || round.createdAt < practiceRoundsCutoff())
            throw new NotFoundException("Practice round not found");
        if (round.userId !== null && round.userId !== userId)
            throw new ForbiddenException(
                "This practice round belongs to another account",
            );
        // Finished, or an empty play (opening the round on another device): stored progress.
        if (round.status !== DailyStatus.IN_PROGRESS || !dto.guesses.length)
            return this.toResponse(
                round,
                await this.evaluate(round),
                round.hintAt,
            );

        const hintAt = dto.hintAt ?? null;
        assertProgressCanGrow(round, dto.guesses, hintAt);
        const evaluation = await this.dailyService.evaluate(
            round,
            dto.guesses,
            hintAt,
        );
        await this.roundRepository.update(round.id, {
            guesses: dto.guesses,
            hintAt,
            status: evaluation.status,
            attempts: evaluation.attempts,
            finishedAt:
                evaluation.status === DailyStatus.IN_PROGRESS
                    ? null
                    : new Date(),
        });
        return this.toResponse(round, evaluation, hintAt);
    }

    private evaluate(round: DailyPracticeRound): Promise<DailyEvaluation> {
        return this.dailyService.evaluate(round, round.guesses, round.hintAt);
    }

    private toResponse(
        round: DailyPracticeRound,
        evaluation: DailyEvaluation,
        hintAt: number | null,
    ): DailyPracticePlayResponseDto {
        return {
            roundId: round.id,
            ...this.dailyService.buildPlayState(round, evaluation, hintAt, {
                p: round.id,
                s: "r",
            }),
        };
    }
}
