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
exports.Library = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var collection_entity_1 = require("../../collections/entities/collection.entity");
var Library = (function () {
    function Library() {
    }
    Library._OPENAPI_METADATA_FACTORY = function () {
        return { id: { required: true, type: function () { return String; }, description: "Also used to share the library with other users." }, userId: { required: true, type: function () { return String; } }, collections: { required: true, type: function () { return [require("../../collections/entities/collection.entity").Collection]; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)("uuid"),
        __metadata("design:type", String)
    ], Library.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: false, unique: true }),
        __metadata("design:type", String)
    ], Library.prototype, "userId", void 0);
    __decorate([
        (0, typeorm_1.OneToMany)(function () { return collection_entity_1.Collection; }, function (collection) { return collection.library; }),
        __metadata("design:type", Array)
    ], Library.prototype, "collections", void 0);
    Library = __decorate([
        (0, typeorm_1.Entity)()
    ], Library);
    return Library;
}());
exports.Library = Library;
//# sourceMappingURL=library.entity.js.map