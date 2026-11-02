/** Platform codes in Nintendo's play history: Switch and Switch 2. */
export type NintendoPlatform = "HAC" | "BEE";

/** IGDB platform IDs, @see GamePlatform#id */
export const NINTENDO_PLATFORM_IDS: Record<NintendoPlatform, number> = {
    HAC: 130,
    BEE: 508,
};

export interface NintendoPlayEntry {
    /** Upper-cased 16-hex title ID. */
    titleId: string;
    titleName?: string;
    platform: NintendoPlatform;
    minutes: number;
    firstPlayedAt?: Date;
    lastPlayedAt?: Date;
}
