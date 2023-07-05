"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionsModule = void 0;
var common_1 = require("@nestjs/common");
var collections_service_1 = require("./collections.service");
var collections_controller_1 = require("./collections.controller");
var typeorm_1 = require("@nestjs/typeorm");
var collection_entity_1 = require("./entities/collection.entity");
var collectionEntry_entity_1 = require("./entities/collectionEntry.entity");
var libraries_module_1 = require("../libraries/libraries.module");
var igdb_module_1 = require("../igdb/igdb.module");
var CollectionsModule = (function () {
    function CollectionsModule() {
    }
    CollectionsModule = __decorate([
        (0, common_1.Module)({
            imports: [
                typeorm_1.TypeOrmModule.forFeature([collection_entity_1.Collection, collectionEntry_entity_1.CollectionEntry]),
                libraries_module_1.LibrariesModule,
                igdb_module_1.IgdbModule,
            ],
            controllers: [collections_controller_1.CollectionsController],
            providers: [collections_service_1.CollectionsService],
            exports: [collections_service_1.CollectionsService],
        })
    ], CollectionsModule);
    return CollectionsModule;
}());
exports.CollectionsModule = CollectionsModule;
//# sourceMappingURL=collections.module.js.map