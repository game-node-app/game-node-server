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
exports.AuthService = void 0;
var common_1 = require("@nestjs/common");
var supertokens_node_1 = require("supertokens-node");
var session_1 = require("supertokens-node/recipe/session");
var dashboard_1 = require("supertokens-node/recipe/dashboard");
var thirdpartypasswordless_1 = require("supertokens-node/recipe/thirdpartypasswordless");
var userroles_1 = require("supertokens-node/recipe/userroles");
var config_interface_1 = require("./config.interface");
var collections_service_1 = require("../collections/collections.service");
var libraries_service_1 = require("../libraries/libraries.service");
var collections_constants_1 = require("../collections/collections.constants");
var constants_1 = require("../utils/constants");
var AuthService = (function () {
    function AuthService(config, collectionsService, librariesService) {
        var _this = this;
        this.config = config;
        this.collectionsService = collectionsService;
        this.librariesService = librariesService;
        this.logger = new common_1.Logger(AuthService_1.name);
        supertokens_node_1.default.init({
            appInfo: config.appInfo,
            supertokens: {
                connectionURI: config.connectionURI,
                apiKey: config.apiKey,
            },
            recipeList: [
                thirdpartypasswordless_1.default.init({
                    flowType: "USER_INPUT_CODE",
                    contactMethod: "EMAIL",
                    providers: [
                        thirdpartypasswordless_1.default.Google({
                            clientId: "1060725074195-kmeum4crr01uirfl2op9kd5acmi9jutn.apps.googleusercontent.com",
                            clientSecret: "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",
                        }),
                        thirdpartypasswordless_1.default.Github({
                            clientId: "467101b197249757c71f",
                            clientSecret: "e97051221f4b6426e8fe8d51486396703012f5bd",
                        }),
                        thirdpartypasswordless_1.default.Apple({
                            clientId: "4398792-io.supertokens.example.service",
                            clientSecret: {
                                keyId: "7M48Y4RYDL",
                                privateKey: "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgu8gXs+XYkqXD6Ala9Sf/iJXzhbwcoG5dMh1OonpdJUmgCgYIKoZIzj0DAQehRANCAASfrvlFbFCYqn3I2zeknYXLwtH30JuOKestDbSfZYxZNMqhF/OzdZFTV0zc5u5s3eN+oCWbnvl0hM+9IW0UlkdA\n-----END PRIVATE KEY-----",
                                teamId: "YWQCXGJRJL",
                            },
                        }),
                    ],
                    override: {
                        apis: function (originalImplementation) {
                            return __assign(__assign({}, originalImplementation), { thirdPartySignInUpPOST: function (input) { return __awaiter(_this, void 0, void 0, function () {
                                    var response;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                if (originalImplementation.thirdPartySignInUpPOST ===
                                                    undefined) {
                                                    throw Error("thirdPartySignInUpPOST is undefined");
                                                }
                                                return [4, originalImplementation.thirdPartySignInUpPOST(input)];
                                            case 1:
                                                response = _a.sent();
                                                if (!(response.status === "OK")) return [3, 3];
                                                if (!response.createdNewUser) return [3, 3];
                                                return [4, this.initUser(response.user.id)];
                                            case 2:
                                                _a.sent();
                                                _a.label = 3;
                                            case 3: return [2, response];
                                        }
                                    });
                                }); }, consumeCodePOST: function (input) { return __awaiter(_this, void 0, void 0, function () {
                                    var response;
                                    return __generator(this, function (_a) {
                                        switch (_a.label) {
                                            case 0:
                                                if (originalImplementation.consumeCodePOST ===
                                                    undefined) {
                                                    throw Error("consumeCodePOST is undefined");
                                                }
                                                return [4, originalImplementation.consumeCodePOST(input)];
                                            case 1:
                                                response = _a.sent();
                                                if (!(response.status === "OK")) return [3, 3];
                                                if (!response.createdNewUser) return [3, 3];
                                                return [4, this.initUser(response.user.id)];
                                            case 2:
                                                _a.sent();
                                                _a.label = 3;
                                            case 3: return [2, response];
                                        }
                                    });
                                }); } });
                        },
                    },
                }),
                userroles_1.default.init(),
                session_1.default.init(),
                dashboard_1.default.init(),
            ],
        });
    }
    AuthService_1 = AuthService;
    AuthService.prototype.initUser = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var e_1, _i, DEFAULT_COLLECTIONS_1, defCollection;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.logger.log("Started init routine for userId ".concat(userId, " at ").concat(new Date().toISOString()));
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4, userroles_1.default.addRoleToUser(userId, constants_1.EUserRoles.USER)];
                    case 2:
                        _a.sent();
                        return [3, 4];
                    case 3:
                        e_1 = _a.sent();
                        return [3, 4];
                    case 4: return [4, this.librariesService.create(userId)];
                    case 5:
                        _a.sent();
                        this.logger.log("Created library for user ".concat(userId, " at signup"));
                        _i = 0, DEFAULT_COLLECTIONS_1 = collections_constants_1.DEFAULT_COLLECTIONS;
                        _a.label = 6;
                    case 6:
                        if (!(_i < DEFAULT_COLLECTIONS_1.length)) return [3, 9];
                        defCollection = DEFAULT_COLLECTIONS_1[_i];
                        return [4, this.collectionsService.create(userId, defCollection)];
                    case 7:
                        _a.sent();
                        _a.label = 8;
                    case 8:
                        _i++;
                        return [3, 6];
                    case 9:
                        this.logger.log("Created default collections for user ".concat(userId, " at signup"));
                        return [2];
                }
            });
        });
    };
    var AuthService_1;
    AuthService = AuthService_1 = __decorate([
        (0, common_1.Injectable)(),
        __param(0, (0, common_1.Inject)(config_interface_1.ConfigInjectionToken)),
        __metadata("design:paramtypes", [Object, collections_service_1.CollectionsService,
            libraries_service_1.LibrariesService])
    ], AuthService);
    return AuthService;
}());
exports.AuthService = AuthService;
//# sourceMappingURL=auth.service.js.map