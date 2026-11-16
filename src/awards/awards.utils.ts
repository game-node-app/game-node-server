import { HttpException, HttpStatus } from "@nestjs/common";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { AwardsEvent } from "./entity/awards-event.entity";
import type { Game } from "../game/game-repository/entities/game.entity";

dayjs.extend(utc);

export type AwardsPhase =
    | "upcoming"
    | "nominations"
    | "nominations_closed"
    | "voting"
    | "voting_closed"
    | "results";

type AwardsEventDates = Pick<
    AwardsEvent,
    | "nominationStartDate"
    | "nominationEndDate"
    | "votingStartDate"
    | "votingEndDate"
    | "resultsDate"
>;

/**
 * Computed at read time; an event without both nomination dates never reports the nomination phases.
 */
export function getAwardsPhase(
    event: AwardsEventDates,
    now: Date = new Date(),
): AwardsPhase {
    const current = dayjs(now);
    if (event.nominationStartDate != null && event.nominationEndDate != null) {
        if (!current.isBefore(event.nominationStartDate)) {
            if (current.isBefore(event.nominationEndDate)) return "nominations";
            if (current.isBefore(event.votingStartDate)) {
                return "nominations_closed";
            }
        }
    }
    if (current.isBefore(event.votingStartDate)) return "upcoming";
    if (current.isBefore(event.votingEndDate)) return "voting";
    if (current.isBefore(event.resultsDate)) return "voting_closed";
    return "results";
}

function eligibilityError(
    event: Pick<AwardsEvent, "year" | "eligibilityCutoffDate">,
    game: Pick<Game, "name" | "firstReleaseDate">,
): string | null {
    if (!game.firstReleaseDate) return null;

    const release = dayjs.utc(game.firstReleaseDate);
    if (release.year() !== event.year) {
        return `Game ${game.name} was released in ${release.year()} and is not part of the ${event.year} awards event.`;
    }

    if (
        event.eligibilityCutoffDate != null &&
        release.isAfter(dayjs.utc(event.eligibilityCutoffDate), "day")
    ) {
        return `Game ${game.name} was released after the ${event.year} awards eligibility cutoff.`;
    }
    return null;
}

/**
 * A game is eligible when released in the event year and, when a cutoff is set, on or before it.
 * Games without a release date stay eligible, as before.
 */
export function isGameEligible(
    event: Pick<AwardsEvent, "year" | "eligibilityCutoffDate">,
    game: Pick<Game, "name" | "firstReleaseDate">,
): boolean {
    return eligibilityError(event, game) == null;
}

export function assertGameEligible(
    event: Pick<AwardsEvent, "year" | "eligibilityCutoffDate">,
    game: Pick<Game, "name" | "firstReleaseDate">,
): void {
    const message = eligibilityError(event, game);
    if (message != null) {
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
}
