"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.CollectionsService = void 0;
var common_1 = require("@nestjs/common");
var typeorm_1 = require("@nestjs/typeorm");
var collection_entity_1 = require("./entities/collection.entity");
var typeorm_2 = require("typeorm");
var libraries_service_1 = require("../libraries/libraries.service");
var igdb_service_1 = require("../igdb/igdb.service");
var collectionEntry_entity_1 = require("./entities/collectionEntry.entity");
function formatCollectionName(name) {
    if (!name) {
        return undefined;
    }
    if (name[0] === name[0].toUpperCase()) {
        return name;
    }
    else {
        return name[0].toUpperCase() + name.slice(1);
    }
}
var CollectionsService = (function () {
    function CollectionsService(collectionsRepository, collectionEntriesRepository, librariesService, igdbService) {
        this.collectionsRepository = collectionsRepository;
        this.collectionEntriesRepository = collectionEntriesRepository;
        this.librariesService = librariesService;
        this.igdbService = igdbService;
    }
    CollectionsService.prototype.findOneById = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionsRepository.findOne({
                        where: {
                            id: id,
                        },
                        relations: {
                            entries: true,
                            library: true,
                        },
                    })];
            });
        });
    };
    CollectionsService.prototype.findOneEntryById = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionEntriesRepository.findOne({
                        where: {
                            id: id,
                        },
                        relations: {
                            collection: true,
                        },
                    })];
            });
        });
    };
    CollectionsService.prototype.findOneEntryByIgdbId = function (igdbId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.collectionEntriesRepository.findOne({
                        where: {
                            data: {
                                igdbId: igdbId,
                            },
                        },
                        relations: {
                            collection: true,
                        },
                    })];
            });
        });
    };
    CollectionsService.prototype.findOneByIdOrFail = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var collection;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.collectionsRepository.findOne({
                            where: {
                                id: id,
                            },
                            relations: {
                                entries: true,
                                library: true,
                            },
                        })];
                    case 1:
                        collection = _a.sent();
                        if (!collection) {
                            throw new common_1.HttpException("Collection not found.", common_1.HttpStatus.NOT_FOUND);
                        }
                        return [2, collection];
                }
            });
        });
    };
    CollectionsService.prototype.create = function (userId, createCollectionDto) {
        return __awaiter(this, void 0, void 0, function () {
            var userLibrary, collectionEntity, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.librariesService.findByUserId(userId)];
                    case 1:
                        userLibrary = _a.sent();
                        if (!userLibrary) {
                            throw new common_1.HttpException("User has no library defined.", common_1.HttpStatus.PRECONDITION_REQUIRED);
                        }
                        collectionEntity = this.collectionsRepository.create({
                            name: formatCollectionName(createCollectionDto.name),
                            description: createCollectionDto.description,
                            library: userLibrary,
                        });
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        return [4, this.collectionsRepository.save(collectionEntity)];
                    case 3: return [2, _a.sent()];
                    case 4:
                        e_1 = _a.sent();
                        throw new common_1.HttpException(e_1, 500);
                    case 5: return [2];
                }
            });
        });
    };
    CollectionsService.prototype.update = function (id, updateCollectionDto) {
        return __awaiter(this, void 0, void 0, function () {
            var collection, updatedCollection;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.findOneByIdOrFail(id)];
                    case 1:
                        collection = _a.sent();
                        updatedCollection = this.collectionsRepository.create(__assign(__assign({}, collection), updateCollectionDto));
                        try {
                            return [2, this.collectionsRepository.save(updatedCollection)];
                        }
                        catch (e) {
                            throw new common_1.HttpException(e, 500);
                        }
                        return [2];
                }
            });
        });
    };
    CollectionsService.prototype.createEntry = function (collectionId, createEntryDto) {
        return __awaiter(this, void 0, void 0, function () {
            var collection, igdbId, games, collectionEntryEntity, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.findOneByIdOrFail(collectionId)];
                    case 1:
                        collection = _a.sent();
                        igdbId = createEntryDto.igdbId;
                        return [4, this.igdbService.findByIdsOrFail({
                                igdbIds: [igdbId],
                            })];
                    case 2:
                        games = _a.sent();
                        collectionEntryEntity = this.collectionEntriesRepository.create({
                            igdbId: igdbId,
                            data: games[0],
                            collection: collection,
                        });
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, , 6]);
                        return [4, this.collectionEntriesRepository.save(collectionEntryEntity)];
                    case 4: return [2, _a.sent()];
                    case 5:
                        e_2 = _a.sent();
                        throw new common_1.HttpException(e_2, 500);
                    case 6: return [2];
                }
            });
        });
    };
    CollectionsService = __decorate([
        (0, common_1.Injectable)(),
        __param(0, (0, typeorm_1.InjectRepository)(collection_entity_1.Collection)),
        __param(1, (0, typeorm_1.InjectRepository)(collectionEntry_entity_1.CollectionEntry)),
        __metadata("design:paramtypes", [typeorm_2.Repository,
            typeorm_2.Repository,
            libraries_service_1.LibrariesService,
            igdb_service_1.IgdbService])
    ], CollectionsService);
    return CollectionsService;
}());
exports.CollectionsService = CollectionsService;
//# sourceMappingURL=collections.service.js.map