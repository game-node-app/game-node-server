"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatisticsService = void 0;
var common_1 = require("@nestjs/common");
var StatisticsService = (function () {
    function StatisticsService() {
    }
    StatisticsService.prototype.create = function (createStatisticDto) {
        return 'This action adds a new statistic';
    };
    StatisticsService.prototype.findAll = function () {
        return "This action returns all statistics";
    };
    StatisticsService.prototype.findOne = function (id) {
        return "This action returns a #".concat(id, " statistic");
    };
    StatisticsService.prototype.update = function (id, updateStatisticDto) {
        return "This action updates a #".concat(id, " statistic");
    };
    StatisticsService.prototype.remove = function (id) {
        return "This action removes a #".concat(id, " statistic");
    };
    StatisticsService = __decorate([
        (0, common_1.Injectable)()
    ], StatisticsService);
    return StatisticsService;
}());
exports.StatisticsService = StatisticsService;
//# sourceMappingURL=statistics.service.js.map