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
exports.Review = void 0;
var openapi = require("@nestjs/swagger");
var typeorm_1 = require("typeorm");
var review_statistics_entity_1 = require("../../statistics/entity/review-statistics.entity");
var Review = (function () {
    function Review() {
    }
    Review._OPENAPI_METADATA_FACTORY = function () {
        return { id: { required: true, type: function () { return String; } }, userId: { required: true, type: function () { return String; } }, reviewStatistics: { required: true, type: function () { return require("../../statistics/entity/review-statistics.entity").ReviewStatistics; } } };
    };
    __decorate([
        (0, typeorm_1.PrimaryGeneratedColumn)("uuid"),
        __metadata("design:type", String)
    ], Review.prototype, "id", void 0);
    __decorate([
        (0, typeorm_1.Column)({ nullable: false }),
        __metadata("design:type", String)
    ], Review.prototype, "userId", void 0);
    __decorate([
        (0, typeorm_1.OneToOne)(function () { return review_statistics_entity_1.ReviewStatistics; }, function (reviewStatistics) { return reviewStatistics.review; }),
        (0, typeorm_1.JoinColumn)(),
        __metadata("design:type", review_statistics_entity_1.ReviewStatistics)
    ], Review.prototype, "reviewStatistics", void 0);
    Review = __decorate([
        (0, typeorm_1.Entity)()
    ], Review);
    return Review;
}());
exports.Review = Review;
//# sourceMappingURL=review.entity.js.map