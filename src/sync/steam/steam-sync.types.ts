export interface Achievement {
    name: string;
    defaultvalue: number;
    displayName: string;
    hidden: number;
    description?: string;
    icon: string;
    icongray: string;
}

export interface GameStatsResponse {
    // Some games simply don't return this.
    availableGameStats?: {
        achievements: Achievement[];
    };
}
