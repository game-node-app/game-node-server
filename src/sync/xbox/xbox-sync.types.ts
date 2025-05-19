export interface XboxGameTitle {
    titleId: string;
    productId: string;
    productIds: string[];
    productIdsWithDeviceTypes: {
        productId: string;
        devices: string[];
    }[];
    pfn: string;
    bingId: string;
    windowsPhoneProductId: string | null;
    name: string;
    type: string;
    devices: string[];
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

export interface XboxStatsItem {
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
