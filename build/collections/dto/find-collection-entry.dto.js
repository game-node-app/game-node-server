"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FindCollectionEntryDto = void 0;
var openapi = require("@nestjs/swagger");
var FindCollectionEntryDto = (function () {
    function FindCollectionEntryDto() {
    }
    FindCollectionEntryDto._OPENAPI_METADATA_FACTORY = function () {
        return { entryId: { required: false, type: function () { return Number; } }, igdbId: { required: false, type: function () { return Number; } } };
    };
    return FindCollectionEntryDto;
}());
exports.FindCollectionEntryDto = FindCollectionEntryDto;
//# sourceMappingURL=find-collection-entry.dto.js.map