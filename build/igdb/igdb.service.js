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
exports.IgdbService = void 0;
var common_1 = require("@nestjs/common");
var igdb_api_node_1 = require("igdb-api-node");
var igdb_utils_1 = require("./igdb.utils");
var igdb_auth_service_1 = require("./igdb.auth.service");
var process = require("process");
var schedule_1 = require("@nestjs/schedule");
var cache_manager_1 = require("@nestjs/cache-manager");
function normalizeResults(results, coverSize, imageSize) {
    var images = [
        { name: "cover", size: coverSize, fallback: "cover_big" },
        {
            name: "screenshots",
            size: imageSize,
            fallback: "screenshot_big",
        },
        { name: "artworks", size: imageSize, fallback: "screenshot_big" },
    ];
    var normalizedResults = [];
    for (var _i = 0, results_1 = results; _i < results_1.length; _i++) {
        var result = results_1[_i];
        var normalizedResult = {
            igdbId: result.id,
            name: result.name,
            category: result.category,
        };
        var _loop_1 = function (image) {
            if (result[image.name]) {
                if (Array.isArray(image)) {
                    normalizedResult[image.name] = result[image.name].map(function (imageProperties) {
                        return (0, igdb_utils_1.getSizedImageUrl)(imageProperties.url, image.size || image.fallback);
                    });
                }
                else {
                    normalizedResult[image.name] = (0, igdb_utils_1.getSizedImageUrl)(result[image.name].url, image.size || image.fallback);
                }
            }
        };
        for (var _a = 0, images_1 = images; _a < images_1.length; _a++) {
            var image = images_1[_a];
            _loop_1(image);
        }
        normalizedResult = __assign(__assign({}, normalizedResult), { dlcs: result.dlcs, expansions: result.expansions, firstReleaseDate: result.first_release_date, genres: result.genres, similarGames: result.similar_games, storyline: result.storyline, totalRating: result.total_rating, igdbUrl: result.url, collection: result.collection });
        normalizedResults.push(normalizedResult);
    }
    return normalizedResults;
}
var IgdbService = (function () {
    function IgdbService(igdbAuthService, cacheManager) {
        this.igdbAuthService = igdbAuthService;
        this.cacheManager = cacheManager;
        this.CACHE_TIME_SECONDS = 1800;
        this.igdbFields = [
            "id",
            "name",
            "screenshots.*",
            "game_modes.*",
            "genres.*",
            "platforms.*",
            "dlcs.*",
            "expansions.*",
            "similar_games",
            "cover.*",
            "artworks.*",
            "collection",
            "category",
        ];
        this.logger = new common_1.Logger(IgdbService_1.name);
        this.buildIgdbClient().then();
    }
    IgdbService_1 = IgdbService;
    IgdbService.prototype.buildIgdbClient = function () {
        return __awaiter(this, void 0, void 0, function () {
            var token;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.igdbAuthService.refreshToken()];
                    case 1:
                        token = _a.sent();
                        this.igdbClient = (0, igdb_api_node_1.default)(process.env.IGDB_CLIENT_ID, token);
                        this.logger.log("Built a fresh IGDB client at " + new Date().toISOString());
                        return [2];
                }
            });
        });
    };
    IgdbService.prototype.getFromStore = function (key) {
        return __awaiter(this, void 0, void 0, function () {
            var e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4, this.cacheManager.get(key)];
                    case 1: return [2, _a.sent()];
                    case 2:
                        e_1 = _a.sent();
                        this.logger.error(e_1.message, e_1.stack);
                        return [2, undefined];
                    case 3: return [2];
                }
            });
        });
    };
    IgdbService.prototype.setToStore = function (key, results) {
        return __awaiter(this, void 0, void 0, function () {
            var e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4, this.cacheManager.set(key, results, this.CACHE_TIME_SECONDS * 1000)];
                    case 1:
                        _a.sent();
                        return [3, 3];
                    case 2:
                        e_2 = _a.sent();
                        this.logger.error(e_2.message, e_2.stack);
                        return [3, 3];
                    case 3: return [2];
                }
            });
        });
    };
    IgdbService.prototype.buildStoreKey = function (dto) {
        return JSON.stringify(dto);
    };
    IgdbService.prototype.findByIds = function (queryIdDto) {
        return __awaiter(this, void 0, void 0, function () {
            var storeKey, cached, e_3, search, idsStringArray, request, results, storeKey, e_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        storeKey = this.buildStoreKey(queryIdDto);
                        return [4, this.getFromStore(storeKey)];
                    case 1:
                        cached = _a.sent();
                        if (cached) {
                            return [2, cached];
                        }
                        return [3, 3];
                    case 2:
                        e_3 = _a.sent();
                        this.logger.error("Error while loading cached entries");
                        this.logger.error(e_3.message, e_3.stack);
                        return [3, 3];
                    case 3:
                        search = this.igdbClient
                            .fields(this.igdbFields)
                            .limit(queryIdDto.limit || 20)
                            .offset(queryIdDto.offset || 0);
                        if (queryIdDto.sort) {
                            search.sort(queryIdDto.sort);
                        }
                        idsStringArray = queryIdDto.igdbIds.map(function (v) { return "".concat(v); });
                        search.where("id = (".concat(idsStringArray, ")"));
                        return [4, search.request("/games")];
                    case 4:
                        request = _a.sent();
                        results = normalizeResults(request.data, queryIdDto.coverSize, queryIdDto.imageSize);
                        _a.label = 5;
                    case 5:
                        _a.trys.push([5, 7, , 8]);
                        storeKey = this.buildStoreKey(queryIdDto);
                        return [4, this.setToStore(storeKey, results)];
                    case 6:
                        _a.sent();
                        return [3, 8];
                    case 7:
                        e_4 = _a.sent();
                        this.logger.error("Error while saving cached entries");
                        this.logger.error(e_4.message, e_4.stack);
                        return [3, 8];
                    case 8: return [2, results];
                }
            });
        });
    };
    IgdbService.prototype.findByIdsOrFail = function (queryIdDto) {
        return __awaiter(this, void 0, void 0, function () {
            var games;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.findByIds(queryIdDto)];
                    case 1:
                        games = _a.sent();
                        if (games === undefined || games.length === 0) {
                            throw new common_1.HttpException("No games found", common_1.HttpStatus.NOT_FOUND);
                        }
                        return [2, games];
                }
            });
        });
    };
    IgdbService.prototype.find = function (queryDto) {
        return __awaiter(this, void 0, void 0, function () {
            var search, results, e_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        search = this.igdbClient
                            .fields(this.igdbFields)
                            .limit(queryDto.limit || 20)
                            .offset(queryDto.offset || 0);
                        if (queryDto.search) {
                            search.search(queryDto.search);
                        }
                        if (queryDto.sort) {
                            search.sort(queryDto.sort);
                        }
                        if (queryDto.where) {
                            search.where(queryDto.where);
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4, search.request("/games")];
                    case 2:
                        results = _a.sent();
                        return [2, normalizeResults(results.data, queryDto.coverSize, queryDto.imageSize)];
                    case 3:
                        e_5 = _a.sent();
                        this.logger.error(e_5.message, e_5.stack);
                        if (e_5.status) {
                            throw new common_1.HttpException(e_5.message, e_5.status);
                        }
                        else {
                            throw new common_1.HttpException(e_5.message, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
                        }
                        return [3, 4];
                    case 4: return [2];
                }
            });
        });
    };
    var IgdbService_1;
    __decorate([
        (0, schedule_1.Interval)(igdb_auth_service_1.tokenRefreshIntervalSeconds * 1000),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", []),
        __metadata("design:returntype", Promise)
    ], IgdbService.prototype, "buildIgdbClient", null);
    IgdbService = IgdbService_1 = __decorate([
        (0, common_1.Injectable)(),
        __param(1, (0, common_1.Inject)(cache_manager_1.CACHE_MANAGER)),
        __metadata("design:paramtypes", [igdb_auth_service_1.IgdbAuthService, Object])
    ], IgdbService);
    return IgdbService;
}());
exports.IgdbService = IgdbService;
//# sourceMappingURL=igdb.service.js.map