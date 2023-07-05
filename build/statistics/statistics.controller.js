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
exports.StatisticsController = void 0;
var openapi = require("@nestjs/swagger");
var common_1 = require("@nestjs/common");
var statistics_service_1 = require("./statistics.service");
var create_statistic_dto_1 = require("./dto/create-statistic.dto");
var update_statistic_dto_1 = require("./dto/update-statistic.dto");
var StatisticsController = (function () {
    function StatisticsController(statisticsService) {
        this.statisticsService = statisticsService;
    }
    StatisticsController.prototype.create = function (createStatisticDto) {
        return this.statisticsService.create(createStatisticDto);
    };
    StatisticsController.prototype.findAll = function () {
        return this.statisticsService.findAll();
    };
    StatisticsController.prototype.findOne = function (id) {
        return this.statisticsService.findOne(+id);
    };
    StatisticsController.prototype.update = function (id, updateStatisticDto) {
        return this.statisticsService.update(+id, updateStatisticDto);
    };
    StatisticsController.prototype.remove = function (id) {
        return this.statisticsService.remove(+id);
    };
    __decorate([
        (0, common_1.Post)(),
        openapi.ApiResponse({ status: 201, type: String }),
        __param(0, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [create_statistic_dto_1.CreateStatisticDto]),
        __metadata("design:returntype", void 0)
    ], StatisticsController.prototype, "create", null);
    __decorate([
        (0, common_1.Get)(),
        openapi.ApiResponse({ status: 200, type: String }),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", []),
        __metadata("design:returntype", void 0)
    ], StatisticsController.prototype, "findAll", null);
    __decorate([
        (0, common_1.Get)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", void 0)
    ], StatisticsController.prototype, "findOne", null);
    __decorate([
        (0, common_1.Patch)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __param(1, (0, common_1.Body)()),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String, update_statistic_dto_1.UpdateStatisticDto]),
        __metadata("design:returntype", void 0)
    ], StatisticsController.prototype, "update", null);
    __decorate([
        (0, common_1.Delete)(':id'),
        openapi.ApiResponse({ status: 200, type: String }),
        __param(0, (0, common_1.Param)('id')),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [String]),
        __metadata("design:returntype", void 0)
    ], StatisticsController.prototype, "remove", null);
    StatisticsController = __decorate([
        (0, common_1.Controller)('statistics'),
        __metadata("design:paramtypes", [statistics_service_1.StatisticsService])
    ], StatisticsController);
    return StatisticsController;
}());
exports.StatisticsController = StatisticsController;
//# sourceMappingURL=statistics.controller.js.map