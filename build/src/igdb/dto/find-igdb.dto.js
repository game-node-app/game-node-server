"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FindIgdbDto = void 0;
var openapi = require("@nestjs/swagger");
var FindIgdbDto = (function () {
    function FindIgdbDto() {
    }
    FindIgdbDto._OPENAPI_METADATA_FACTORY = function () {
        return { coverSize: { required: false, type: function () { return Object; } }, imageSize: { required: false, type: function () { return Object; } }, search: { required: false, type: function () { return String; } }, where: { required: false, type: function () { return Object; } }, limit: { required: false, type: function () { return Number; } }, offset: { required: false, type: function () { return Number; } }, sort: { required: false, type: function () { return String; } } };
    };
    return FindIgdbDto;
}());
exports.FindIgdbDto = FindIgdbDto;
//# sourceMappingURL=find-igdb.dto.js.map