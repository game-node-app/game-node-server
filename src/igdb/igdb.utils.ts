import { ImageSize } from "./igdb.constants";

export function getSizedImageUrl(url: string, size: ImageSize) {
    if (url == null) {
        return undefined;
    }
    const regex = /(?<=t_)[^/]+(?=\/[^/]*$)/;
    if (url.match(regex) != null) {
        if (url.startsWith("//")) {
            url = "https:" + url;
        }
        return url.replace(regex, size);
    } else {
        return url;
    }
}
