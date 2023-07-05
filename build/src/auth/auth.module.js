"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
var common_1 = require("@nestjs/common");
var auth_middleware_1 = require("./auth.middleware");
var config_interface_1 = require("./config.interface");
var auth_service_1 = require("./auth.service");
var libraries_module_1 = require("../libraries/libraries.module");
var collections_module_1 = require("../collections/collections.module");
var auth_controller_1 = require("./auth.controller");
var AuthModule = (function () {
    function AuthModule() {
    }
    AuthModule_1 = AuthModule;
    AuthModule.prototype.configure = function (consumer) {
        consumer.apply(auth_middleware_1.AuthMiddleware).forRoutes("*");
    };
    AuthModule.forRoot = function (_a) {
        var connectionURI = _a.connectionURI, apiKey = _a.apiKey, appInfo = _a.appInfo;
        return {
            providers: [
                {
                    useValue: {
                        appInfo: appInfo,
                        connectionURI: connectionURI,
                        apiKey: apiKey,
                    },
                    provide: config_interface_1.ConfigInjectionToken,
                },
                auth_service_1.AuthService,
            ],
            exports: [],
            imports: [libraries_module_1.LibrariesModule, collections_module_1.CollectionsModule],
            module: AuthModule_1,
        };
    };
    var AuthModule_1;
    AuthModule = AuthModule_1 = __decorate([
        (0, common_1.Module)({
            providers: [],
            exports: [],
            controllers: [auth_controller_1.AuthController],
        })
    ], AuthModule);
    return AuthModule;
}());
exports.AuthModule = AuthModule;
//# sourceMappingURL=auth.module.js.map