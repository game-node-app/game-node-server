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
exports.IgdbAuthService = exports.tokenRefreshIntervalSeconds = void 0;
var process = require("process");
var rxjs_1 = require("rxjs");
var common_1 = require("@nestjs/common");
var axios_1 = require("@nestjs/axios");
var cache_manager_1 = require("@nestjs/cache-manager");
exports.tokenRefreshIntervalSeconds = 604800;
var IgdbAuthService = (function () {
    function IgdbAuthService(httpService, cacheManager) {
        this.httpService = httpService;
        this.cacheManager = cacheManager;
        this.cacheKey = "TWITCH_ACCESS_TOKEN";
        this.logger = new common_1.Logger(IgdbAuthService.name);
    }
    IgdbAuthService.prototype.getFromStore = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2, this.cacheManager.get(this.cacheKey)];
            });
        });
    };
    IgdbAuthService.prototype.setToStore = function (token) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.cacheManager.set(this.cacheKey, token, exports.tokenRefreshIntervalSeconds * 1000)];
                    case 1:
                        _a.sent();
                        return [2];
                }
            });
        });
    };
    IgdbAuthService.prototype.fetchToken = function () {
        return __awaiter(this, void 0, void 0, function () {
            var clientId, clientSecret, response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        clientId = process.env.TWITCH_CLIENT_ID;
                        clientSecret = process.env.TWITCH_CLIENT_SECRET;
                        if (!clientId || !clientSecret) {
                            throw new Error("TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET is not defined. Aborting.");
                        }
                        return [4, this.httpService.post("https://id.twitch.tv/oauth2/token", null, {
                                params: {
                                    client_id: clientId,
                                    client_secret: clientSecret,
                                    grant_type: "client_credentials",
                                },
                            })];
                    case 1:
                        response = _a.sent();
                        return [2, (0, rxjs_1.lastValueFrom)(response.pipe((0, rxjs_1.map)(function (res) {
                                var data = res.data;
                                if (typeof data.expires_in === "number") {
                                    data.expires_in = Date.now() + data.expires_in * 1000;
                                }
                                return data;
                            })))];
                }
            });
        });
    };
    IgdbAuthService.prototype.refreshToken = function () {
        return __awaiter(this, void 0, void 0, function () {
            var tokenOnStore, considerExpiredAt, token, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, this.getFromStore()];
                    case 1:
                        tokenOnStore = _a.sent();
                        considerExpiredAt = Date.now() + exports.tokenRefreshIntervalSeconds * 1000;
                        if (!(tokenOnStore == undefined ||
                            tokenOnStore.expires_in < considerExpiredAt)) return [3, 7];
                        this.logger.log("Token is expired or not found. Fetching new token.");
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 5, , 6]);
                        return [4, this.fetchToken()];
                    case 3:
                        token = _a.sent();
                        this.logger.log("Token fetched sucessfully at ".concat(new Date().toISOString()));
                        return [4, this.setToStore(token)];
                    case 4:
                        _a.sent();
                        return [2, token.access_token];
                    case 5:
                        e_1 = _a.sent();
                        this.logger.error(e_1.message, e_1.stack);
                        if (tokenOnStore != undefined &&
                            tokenOnStore.expires_in > Date.now()) {
                            this.logger.log("Using store token as it has not expired.");
                            return [2, tokenOnStore.access_token];
                        }
                        else {
                            this.logger.error("Failed to fetch token and store token is expired or nonexistent.");
                            this.logger.error("IGDB services will be unavailable. Aborting.");
                            throw new Error("Failed to fetch token. Aborting.");
                        }
                        return [3, 6];
                    case 6: return [3, 8];
                    case 7:
                        this.logger.log("Found a valid IGDB token on store.");
                        return [2, tokenOnStore.access_token];
                    case 8: return [2];
                }
            });
        });
    };
    IgdbAuthService = __decorate([
        __param(1, (0, common_1.Inject)(cache_manager_1.CACHE_MANAGER)),
        __metadata("design:paramtypes", [axios_1.HttpService, Object])
    ], IgdbAuthService);
    return IgdbAuthService;
}());
exports.IgdbAuthService = IgdbAuthService;
//# sourceMappingURL=igdb.auth.service.js.map