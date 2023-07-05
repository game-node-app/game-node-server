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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewsController = void 0;
var openapi = require("@nestjs/swagger");
var common_1 = require("@nestjs/common");
var reviews_service_1 = require("./reviews.service");
var create_review_dto_1 = require("./dto/create-review.dto");
var update_review_dto_1 = require("./dto/update-review.dto");
var ReviewsController = (function () {
    function ReviewsController(reviewsService) {
        this.reviewsService = reviewsService;
    }
    ReviewsController.prototype.create = function (createReviewDto) {
        return this.reviewsService.create(createReviewDto);
    };
    ReviewsController.prototype.findAll = function () {
        return this.reviewsService.findAll();
    };
    ReviewsController.prototype.findOne = function (id) {
        return this.reviewsService.findOne(+id);
    };
    ReviewsController.prototype.update = function (id, updateReviewDto) {
        return this.reviewsService.update(+id, updateReviewDto);
    };
    ReviewsController.prototype.remove = function (id) {
        return this.reviewsService.remove(+id);
    };
    __decorate([
        (0, common_1.Post)(),
        openapi.ApiResponse({ status: 201, type: String }),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [create_review_dto_1.CreateReviewDto]),
        __metadata("design:returntype", void 0)
    ], ReviewsController.prototype, "create", null);
    __decorate([
        (0, common_1.Get)(),
        openapi.ApiResponse({ status: 200, type: String }),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", []),
        __metadata("design:returntype", void 0)
    ], ReviewsController.prototype, "findAll", null);
    __decorate([
        (0, common_1.Get)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", void 0)
    ], ReviewsController.prototype, "findOne", null);
    __decorate([
        (0, common_1.Patch)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __param(1, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String, update_review_dto_1.UpdateReviewDto]),
        __metadata("design:returntype", void 0)
    ], ReviewsController.prototype, "update", null);
    __decorate([
        (0, common_1.Delete)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", void 0)
    ], ReviewsController.prototype, "remove", null);
    ReviewsController = __decorate([
        (0, common_1.Controller)('reviews'),
        __metadata("design:paramtypes", [reviews_service_1.ReviewsService])
    ], ReviewsController);
    return ReviewsController;
}());
exports.ReviewsController = ReviewsController;
//# sourceMappingURL=reviews.controller.js.map