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
exports.Collection = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var library_entity_1 = require("../../libraries/entities/library.entity");
var collectionEntry_entity_1 = require("./collectionEntry.entity");
var Collection = (function () {
    function Collection() {
    }
    Collection._OPENAPI_METADATA_FACTORY = function () {
        return { id: { required: true, type: function () { return String; } }, name: { required: true, type: function () { return String; } }, description: { required: true, type: function () { return String; } }, isPublic: { required: true, type: function () { return Boolean; } }, library: { required: true, type: function () { return require("../../libraries/entities/library.entity").Library; } }, entries: { required: true, type: function () { return [require("./collectionEntry.entity").CollectionEntry]; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)("uuid"),
        __metadata("design:type", String)
    ], Collection.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: false }),
        __metadata("design:type", String)
    ], Collection.prototype, "name", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], Collection.prototype, "description", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: false, default: false }),
        __metadata("design:type", Boolean)
    ], Collection.prototype, "isPublic", void 0);
    __decorate([
        (0, typeorm_1.ManyToOne)(function () { return library_entity_1.Library; }, function (library) { return library.collections; }, {
            nullable: false,
        }),
        __metadata("design:type", library_entity_1.Library)
    ], Collection.prototype, "library", void 0);
    __decorate([
        (0, typeorm_1.OneToMany)(function () { return collectionEntry_entity_1.CollectionEntry; }, function (collectionEntry) { return collectionEntry.collection; }),
        __metadata("design:type", Array)
    ], Collection.prototype, "entries", void 0);
    Collection = __decorate([
        (0, typeorm_1.Entity)()
    ], Collection);
    return Collection;
}());
exports.Collection = Collection;
//# sourceMappingURL=collection.entity.js.map