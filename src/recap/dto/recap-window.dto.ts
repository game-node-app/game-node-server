export type RecapPhase = "upcoming" | "live" | "closed";

export class RecapWindowDto {
    year: number;
    /**
     * UTC instant the Recap opens.
     */
    opensAt: Date;
    /**
     * UTC instant the year ends and the Recap closes.
     */
    closesAt: Date;
}

export class RecapCurrentDto extends RecapWindowDto {
    phase: RecapPhase;
}
