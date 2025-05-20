export interface XboxLiveAuthorization {
    userHash: string;
    XSTSToken: string;
}

export type ProfileResponse = {
    profileUsers: [
        {
            id: string;
            hostId: string;
            settings: Array<{
                id:
                    | "GameDisplayPicRaw"
                    | "Gamerscore"
                    | "Gamertag"
                    | "AccountTier"
                    | "XboxOneRep"
                    | "PreferredColor"
                    | "RealName"
                    | "Bio"
                    | "Location"
                    | "ModernGamertag"
                    | "ModernGamertagSuffix"
                    | "UniqueModernGamertag"
                    | "RealNameOverride"
                    | "TenureLevel"
                    | "Watermarks"
                    | "IsQuarantined"
                    | "DisplayedLinkedAccounts";
                value: string;
            }>;
            isSponsoredUser: false;
        },
    ];
};

type XboxGameTitleDeviceType = "Xbox360" | "XboxOne" | "XboxSeries" | "PC";

export interface XboxGameTitle {
    titleId: string;
    productId: string;
    productIds: string[];
    productIdsWithDeviceTypes: {
        productId: string;
        devices: XboxGameTitleDeviceType[];
    }[];
    pfn: string;
    bingId: string;
    windowsPhoneProductId: string | null;
    name: string;
    type: string;
    devices: XboxGameTitleDeviceType[];
    displayImage: string;
    mediaItemType: string;
    modernTitleId: string;
    isBundle: boolean;
    achievement: any | null;
    stats: any | null;
    gamePass: any | null;
    images: any | null;
    titleHistory: {
        lastTimePlayed: string;
        visible: boolean;
        canHide: boolean;
    };
    titleRecord: any | null;
    detail: any | null;
    friendsWhoPlayed: any | null;
    alternateTitleIds: any | null;
    contentBoards: any | null;
    xboxLiveTier: string;
}

export interface XboxMinutesPlayedStatsItem {
    groupproperties: Record<string, unknown>;
    // User's XUID
    xuid: string;
    scid: string;
    titleid: string;
    name: string;
    // Usually "Integer", doesn't mean the 'value' is defined.
    type: string;
    value?: string;
    properties: Record<string, unknown>;
}

export interface XboxBatchMinutesPlayedResponse {
    groups: unknown[];
    // If only MinutesPlayed are being requested, this is a single item list.
    statlistscollection: {
        arrangebyfield: string;
        arrangebyfieldid: string;
        stats: XboxMinutesPlayedStatsItem[];
    }[];
}
