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
exports.UserLike = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var game_statistics_entity_1 = require("./game-statistics.entity");
var review_statistics_entity_1 = require("./review-statistics.entity");
var UserLike = (function () {
    function UserLike() {
    }
    UserLike._OPENAPI_METADATA_FACTORY = function () {
        return { id: { required: true, type: function () { return Number; } }, userId: { required: true, type: function () { return String; } }, gameStatistics: { required: true, type: function () { return require("./game-statistics.entity").GameStatistics; } }, reviewStatistics: { required: true, type: function () { return require("./review-statistics.entity").ReviewStatistics; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)(),
        __metadata("design:type", Number)
    ], UserLike.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)(),
        __metadata("design:type", String)
    ], UserLike.prototype, "userId", void 0);
    __decorate([
        (0, typeorm_1.ManyToOne)(function () { return game_statistics_entity_1.GameStatistics; }, function (gameStatistics) { return gameStatistics.likes; }),
        __metadata("design:type", game_statistics_entity_1.GameStatistics)
    ], UserLike.prototype, "gameStatistics", void 0);
    __decorate([
        (0, typeorm_1.ManyToOne)(function () { return review_statistics_entity_1.ReviewStatistics; }, function (reviewStatistics) { return reviewStatistics.likes; }),
        __metadata("design:type", review_statistics_entity_1.ReviewStatistics)
    ], UserLike.prototype, "reviewStatistics", void 0);
    UserLike = __decorate([
        (0, typeorm_1.Entity)(),
        (0, typeorm_1.Unique)(["userId", "gameStatistics"]),
        (0, typeorm_1.Unique)(["userId", "reviewStatistics"])
    ], UserLike);
    return UserLike;
}());
exports.UserLike = UserLike;
//# sourceMappingURL=user-like.entity.js.map