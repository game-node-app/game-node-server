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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionsController = void 0;
var openapi = require("@nestjs/swagger");
var common_1 = require("@nestjs/common");
var collections_service_1 = require("./collections.service");
var create_collection_dto_1 = require("./dto/create-collection.dto");
var auth_guard_1 = require("../auth/auth.guard");
var session_decorator_1 = require("../auth/session.decorator");
var create_collectionEntry_dto_1 = require("./dto/create-collectionEntry.dto");
var find_collection_entry_dto_1 = require("./dto/find-collection-entry.dto");
var swagger_1 = require("@nestjs/swagger");
var cache_manager_1 = require("@nestjs/cache-manager");
var CollectionsController = (function () {
    function CollectionsController(collectionsService) {
        this.collectionsService = collectionsService;
    }
    CollectionsController.prototype.findOneById = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionsService.findOneById(id)];
            });
        });
    };
    CollectionsController.prototype.create = function (session, createCollectionDto) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionsService.create(session.getUserId(), createCollectionDto)];
            });
        });
    };
    CollectionsController.prototype.getEntries = function (collectionId, findEntryDto) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (findEntryDto.entryId) {
                    return [2, this.collectionsService.findOneEntryById(findEntryDto.entryId)];
                }
                else if (findEntryDto.igdbId) {
                    return [2, this.collectionsService.findOneEntryByIgdbId(findEntryDto.igdbId)];
                }
                else {
                    throw new common_1.HttpException("Invalid query. Either entryId or igdbId must be provided.", 400);
                }
                return [2];
            });
        });
    };
    CollectionsController.prototype.addEntry = function (collectionId, createCollectionEntryDto) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionsService.createEntry(collectionId, createCollectionEntryDto)];
            });
        });
    };
    __decorate([
        (0, common_1.Get)(":id"),
        openapi.ApiResponse({ status: 200, type: Object }),
        __param(0, (0, common_1.Param)("id")),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", Promise)
    ], CollectionsController.prototype, "findOneById", null);
    __decorate([
        (0, common_1.Post)(),
        openapi.ApiResponse({ status: 201, type: require("./entities/collection.entity").Collection }),
        __param(0, (0, session_decorator_1.Session)()),
        __param(1, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object, create_collection_dto_1.CreateCollectionDto]),
        __metadata("design:returntype", Promise)
    ], CollectionsController.prototype, "create", null);
    __decorate([
        openapi.ApiOperation({ description: "Returns a specific collection entry based on ID or IGDB ID\nIt's redudant to return all the entries in the collection, since it's already\nincluded in the /collections/:id endpoint." }),
        (0, common_1.Get)(":colId/entries"),
        (0, swagger_1.ApiBadRequestResponse)({ description: "Invalid query" }),
        openapi.ApiResponse({ status: 200, type: Object }),
        __param(0, (0, common_1.Param)("colId")),
        __param(1, (0, common_1.Query)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String, find_collection_entry_dto_1.FindCollectionEntryDto]),
        __metadata("design:returntype", Promise)
    ], CollectionsController.prototype, "getEntries", null);
    __decorate([
        (0, common_1.Post)(":colId/entries"),
        openapi.ApiResponse({ status: 201, type: require("./entities/collectionEntry.entity").CollectionEntry }),
        __param(0, (0, common_1.Param)("colId")),
        __param(1, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String, create_collectionEntry_dto_1.CreateCollectionEntryDto]),
        __metadata("design:returntype", Promise)
    ], CollectionsController.prototype, "addEntry", null);
    CollectionsController = __decorate([
        (0, common_1.Controller)("collections"),
        (0, common_1.UseGuards)(new auth_guard_1.AuthGuard()),
        (0, common_1.UseInterceptors)(cache_manager_1.CacheInterceptor),
        __metadata("design:paramtypes", [collections_service_1.CollectionsService])
    ], CollectionsController);
    return CollectionsController;
}());
exports.CollectionsController = CollectionsController;
//# sourceMappingURL=collections.controller.js.map