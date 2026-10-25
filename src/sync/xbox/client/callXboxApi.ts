import axios, { AxiosRequestConfig } from "axios";
import { cancellableProviderCall } from "../../player-sync-attempt";
import { XboxLiveAuthorization } from "../xbox-sync.types";

export const USER_AGENT = [
    "Mozilla/5.0 (XboxReplay; XboxLiveAPI/3.0)",
    "AppleWebKit/537.36 (KHTML, like Gecko)",
    "Chrome/71.0.3578.98 Safari/537.36",
].join(" ");

/**
 * Prepares and sends a request to the XboxLive API.
 * @param request
 * @param auth
 * @param contractVersion
 * @param playerXUID
 * @throws AxiosError
 */
export async function callXboxAPI<T = unknown>(
    request: AxiosRequestConfig = {},
    { userHash, XSTSToken }: XboxLiveAuthorization,
    contractVersion = 2,
    playerXUID?: string,
): Promise<T> {
    const BASE_HEADERS = {
        "x-xbl-contract-version": contractVersion,
        Accept: "application/json",
        "Accept-encoding": "gzip",
        "Accept-Language": "en-US",
        "User-Agent": USER_AGENT,
        Authorization: `XBL3.0 x=${userHash};${XSTSToken}`,
    };

    request.responseType = request.responseType || "json";

    request.headers = {
        ...BASE_HEADERS,
        ...request.headers,
    };

    const xuidMatch =
        typeof request.url === "string"
            ? request.url.match(/users\/xuid\((\d+)\)/)
            : null;
    const bodyXuid = Array.isArray(request.data?.xuids)
        ? request.data.xuids[0]
        : null;
    const resolvedXuid = playerXUID || xuidMatch?.[1] || bodyXuid;

    const providerKey =
        resolvedXuid && resolvedXuid !== "2535470385649416"
            ? `Xbox:user:${resolvedXuid}`
            : userHash || XSTSToken
              ? "Xbox:catalog"
              : "Xbox";

    return cancellableProviderCall(
        providerKey,
        async (signal) =>
            (
                await axios.request({
                    ...request,
                    timeout: Math.min(request.timeout || 30_000, 30_000),
                    signal: request.signal
                        ? AbortSignal.any([
                              request.signal as AbortSignal,
                              signal,
                          ])
                        : signal,
                })
            ).data,
    );
}
