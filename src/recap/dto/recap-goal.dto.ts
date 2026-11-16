export class RecapGoalDto {
    year: number;
    /**
     * Null when the user has not set a goal for the year.
     */
    target: number | null;
    /**
     * Games finished in the year so far.
     */
    finished: number;
}
