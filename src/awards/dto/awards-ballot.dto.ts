import { ApiProperty } from "@nestjs/swagger";
import type { AwardsPhase } from "../awards.utils";
import type { AwardsPlayStatus } from "../play-context/awards-play-context.service";
import { AwardsCategoryTranslationDto } from "./awards-category-translation.dto";

export class AwardsBallotNomineeDto {
    gameId: number;
    status: AwardsPlayStatus;
    /** Total playtime recorded for the user and game, in seconds. */
    playtimeSeconds: number;
    /** The user's review rating, from 0 to 5, or null. */
    rating: number | null;
}

export class AwardsBallotCategoryDto {
    id: number;
    name: string;
    description: string;
    @ApiProperty({ type: [AwardsCategoryTranslationDto] })
    translations: AwardsCategoryTranslationDto[];
    order: number;
    isPersonalGOTY: boolean;
    /** The game the user voted for in this category, or null. */
    voteGameId: number | null;
    /** How many of this category's nominees the user played. */
    playedNomineesCount: number;
    nominees: AwardsBallotNomineeDto[];
    /** Only the personal-GOTY category suggests a game; null elsewhere. */
    suggestedGameId: number | null;
}

export class AwardsBallotDto {
    eventId: number;
    year: number;
    phase: AwardsPhase;
    categoriesVoted: number;
    categoriesTotal: number;
    categories: AwardsBallotCategoryDto[];
}

export class AwardsUserVoteDto {
    categoryId: number;
    gameId: number;
}
