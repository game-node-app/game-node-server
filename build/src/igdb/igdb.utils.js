"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSizedImageUrl = void 0;
function getSizedImageUrl(url, size) {
    if (url == null) {
        return undefined;
    }
    var regex = /(?<=t_)[^/]+(?=\/[^/]*$)/;
    if (url.match(regex) != null) {
        if (url.startsWith("//")) {
            url = "https:" + url;
        }
        return url.replace(regex, size);
    }
    else {
        return url;
    }
}
exports.getSizedImageUrl = getSizedImageUrl;
//# sourceMappingURL=igdb.utils.js.map