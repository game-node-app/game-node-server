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
exports.GameStatistics = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var user_like_entity_1 = require("./user-like.entity");
var GameStatistics = (function () {
    function GameStatistics() {
    }
    GameStatistics._OPENAPI_METADATA_FACTORY = function () {
        return { igdbId: { required: true, type: function () { return Number; } }, likes: { required: true, type: function () { return [require("./user-like.entity").UserLike]; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryColumn)(),
        __metadata("design:type", Number)
    ], GameStatistics.prototype, "igdbId", void 0);
    __decorate([
        (0, typeorm_1.OneToMany)(function () { return user_like_entity_1.UserLike; }, function (userLike) { return userLike.gameStatistics; }),
        __metadata("design:type", Array)
    ], GameStatistics.prototype, "likes", void 0);
    GameStatistics = __decorate([
        (0, typeorm_1.Entity)()
    ], GameStatistics);
    return GameStatistics;
}());
exports.GameStatistics = GameStatistics;
//# sourceMappingURL=game-statistics.entity.js.map