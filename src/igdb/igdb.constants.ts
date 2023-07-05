export enum DataSources {
    igdb = "igdb",
    psn = "psn",
    steam = "steam",
    xbox = "xbox",
}

enum PossibleImageSizes {
    cover_small = "cover_small",
    screenshot_med = "screenshot_med",
    cover_big = "cover_big",
    logo_med = "logo_med",
    screenshot_big = "screenshot_big",
    screenshot_huge = "screenshot_huge",
    thumb = "thumb",
    micro = "micro",
    "720p" = "720p",
    "1080p" = "1080p",
}

export type ImageSize = keyof typeof PossibleImageSizes;
