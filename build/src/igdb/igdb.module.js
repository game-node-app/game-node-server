"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IgdbModule = void 0;
var common_1 = require("@nestjs/common");
var igdb_service_1 = require("./igdb.service");
var igdb_controller_1 = require("./igdb.controller");
var axios_1 = require("@nestjs/axios");
var igdb_auth_service_1 = require("./igdb.auth.service");
var IgdbModule = (function () {
    function IgdbModule() {
    }
    IgdbModule = __decorate([
        (0, common_1.Module)({
            imports: [axios_1.HttpModule],
            controllers: [igdb_controller_1.IgdbController],
            providers: [igdb_service_1.IgdbService, igdb_auth_service_1.IgdbAuthService],
            exports: [igdb_service_1.IgdbService],
        })
    ], IgdbModule);
    return IgdbModule;
}());
exports.IgdbModule = IgdbModule;
//# sourceMappingURL=igdb.module.js.map