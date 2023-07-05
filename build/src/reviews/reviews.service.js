"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewsService = void 0;
var common_1 = require("@nestjs/common");
var ReviewsService = (function () {
    function ReviewsService() {
    }
    ReviewsService.prototype.create = function (createReviewDto) {
        return 'This action adds a new review';
    };
    ReviewsService.prototype.findAll = function () {
        return "This action returns all reviews";
    };
    ReviewsService.prototype.findOne = function (id) {
        return "This action returns a #".concat(id, " review");
    };
    ReviewsService.prototype.update = function (id, updateReviewDto) {
        return "This action updates a #".concat(id, " review");
    };
    ReviewsService.prototype.remove = function (id) {
        return "This action removes a #".concat(id, " review");
    };
    ReviewsService = __decorate([
        (0, common_1.Injectable)()
    ], ReviewsService);
    return ReviewsService;
}());
exports.ReviewsService = ReviewsService;
//# sourceMappingURL=reviews.service.js.map