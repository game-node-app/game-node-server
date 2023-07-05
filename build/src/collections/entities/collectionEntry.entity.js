"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionEntry = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var collection_entity_1 = require("./collection.entity");
var game_metadata_dto_1 = require("../../utils/game-metadata.dto");
var CollectionEntry = (function () {
    function CollectionEntry() {
    }
    CollectionEntry._OPENAPI_METADATA_FACTORY = function () {
        return { id: { required: true, type: function () { return Number; }, description: "Not to be confused with the igdbId property from GameMetadata" }, igdbId: { required: true, type: function () { return Number; }, description: "Redudant, since it's also available in the data property.\nStill, this allows us to easily find a entry by the igdbId, so it's worth it.\nFeel free to open a PR if you have a better idea (i know you do)." }, data: { required: true, type: function () { return require("../../utils/game-metadata.dto").GameMetadata; } }, collection: { required: true, type: function () { return require("./collection.entity").Collection; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)(),
        __metadata("design:type", Number)
    ], CollectionEntry.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: false }),
        __metadata("design:type", Number)
    ], CollectionEntry.prototype, "igdbId", void 0);
    __decorate([
        (0, typeorm_1.Column)({
            nullable: false,
            type: "json",
        }),
        __metadata("design:type", game_metadata_dto_1.GameMetadata)
    ], CollectionEntry.prototype, "data", void 0);
    __decorate([
        (0, typeorm_1.ManyToOne)(function () { return collection_entity_1.Collection; }, function (collection) { return collection.entries; }, {
            nullable: false,
        }),
        __metadata("design:type", collection_entity_1.Collection)
    ], CollectionEntry.prototype, "collection", void 0);
    CollectionEntry = __decorate([
        (0, typeorm_1.Entity)()
    ], CollectionEntry);
    return CollectionEntry;
}());
exports.CollectionEntry = CollectionEntry;
//# sourceMappingURL=collectionEntry.entity.js.map