import { ProfileResponse, XboxLiveAuthorization } from "../xbox-sync.types";
import { isXboxXUID } from "./isXboxXUID";
import { callXboxAPI } from "./callXboxApi";

export async function getXboxPlayerXUID(
    gamertag: string,
    auth: XboxLiveAuthorization,
) {
    if (isXboxXUID(gamertag)) {
        return gamertag;
    }

    const url = `https://profile.xboxlive.com/users/gt(${encodeURIComponent(gamertag)})/settings`;

    const response = await callXboxAPI<ProfileResponse>(
        {
            url,
        },
        auth,
    );

    if (response?.profileUsers?.[0]?.id === void 0) {
        throw new Error(`Failed to resolve's players XUID: ${gamertag}`);
    }

    return response.profileUsers[0].id.toString();
}
