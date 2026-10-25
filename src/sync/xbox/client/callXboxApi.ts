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
 * @throws AxiosError
 */
export async function callXboxAPI<T = unknown>(
    request: AxiosRequestConfig = {},
    { userHash, XSTSToken }: XboxLiveAuthorization,
    contractVersion = 2,
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

    return cancellableProviderCall(
        "Xbox",
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
