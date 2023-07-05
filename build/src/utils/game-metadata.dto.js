"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameMetadata = void 0;
var openapi = require("@nestjs/swagger");
var GameMetadata = (function () {
    function GameMetadata() {
    }
    GameMetadata._OPENAPI_METADATA_FACTORY = function () {
        return { igdbId: { required: true, type: function () { return Number; } }, name: { required: true, type: function () { return String; } }, storyline: { required: false, type: function () { return String; } }, totalRating: { required: false, type: function () { return Number; } }, igdbUrl: { required: false, type: function () { return String; } }, cover: { required: false, type: function () { return String; }, description: "Cover image URL (if available)" }, screenshots: { required: false, type: function () { return [String]; } }, artworks: { required: false, type: function () { return [String]; } }, category: { required: true, type: function () { return Number; } }, collection: { required: false, type: function () { return Number; } }, dlcs: { required: false, type: function () { return [Number]; } }, expansions: { required: false, type: function () { return [Number]; } }, firstReleaseDate: { required: false, type: function () { return Number; } }, genres: { required: false, type: function () { return [String]; } }, similarGames: { required: false, type: function () { return [Number]; } } };
    };
    return GameMetadata;
}());
exports.GameMetadata = GameMetadata;
//# sourceMappingURL=game-metadata.dto.js.map