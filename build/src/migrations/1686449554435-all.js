"use strict";
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
exports.All1686449554435 = void 0;
var All1686449554435 = (function () {
    function All1686449554435() {
        this.name = 'All1686449554435';
    }
    All1686449554435.prototype.up = function (queryRunner) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, queryRunner.query("ALTER TABLE `collection` DROP FOREIGN KEY `FK_69a61c8e75ea5b2d9affc23bd12`")];
                    case 1:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` DROP PRIMARY KEY")];
                    case 2:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` DROP COLUMN `id`")];
                    case 3:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` ADD `id` varchar(36) NOT NULL PRIMARY KEY")];
                    case 4:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection_entry` DROP FOREIGN KEY `FK_4f24fd39e03d1586c1ddd7dee0e`")];
                    case 5:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` DROP PRIMARY KEY")];
                    case 6:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` DROP COLUMN `id`")];
                    case 7:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` ADD `id` varchar(36) NOT NULL PRIMARY KEY")];
                    case 8:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` DROP FOREIGN KEY `FK_03a68335a1e7de9daf07210b7e9`")];
                    case 9:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` DROP FOREIGN KEY `FK_d4a58817f04e0f6d8dc5dd9c5bc`")];
                    case 10:
                        _a.sent();
                        return [4, queryRunner.query("DROP INDEX `IDX_2d00614139fa7c316268aef68e` ON `user_like`")];
                    case 11:
                        _a.sent();
                        return [4, queryRunner.query("DROP INDEX `IDX_4ba7ead7dc31eb4ace08d7d775` ON `user_like`")];
                    case 12:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` CHANGE `gameStatisticsIgdbId` `gameStatisticsIgdbId` int NULL")];
                    case 13:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` CHANGE `reviewStatisticsId` `reviewStatisticsId` int NULL")];
                    case 14:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` DROP FOREIGN KEY `FK_290fa2cb2c806c07e630c1dd96d`")];
                    case 15:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` DROP PRIMARY KEY")];
                    case 16:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` DROP COLUMN `id`")];
                    case 17:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` ADD `id` varchar(36) NOT NULL PRIMARY KEY")];
                    case 18:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` CHANGE `reviewStatisticsId` `reviewStatisticsId` int NULL")];
                    case 19:
                        _a.sent();
                        return [4, queryRunner.query("CREATE UNIQUE INDEX `IDX_4ba7ead7dc31eb4ace08d7d775` ON `user_like` (`userId`, `reviewStatisticsId`)")];
                    case 20:
                        _a.sent();
                        return [4, queryRunner.query("CREATE UNIQUE INDEX `IDX_2d00614139fa7c316268aef68e` ON `user_like` (`userId`, `gameStatisticsIgdbId`)")];
                    case 21:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection_entry` ADD CONSTRAINT `FK_4f24fd39e03d1586c1ddd7dee0e` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 22:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` ADD CONSTRAINT `FK_69a61c8e75ea5b2d9affc23bd12` FOREIGN KEY (`libraryId`) REFERENCES `library`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 23:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` ADD CONSTRAINT `FK_03a68335a1e7de9daf07210b7e9` FOREIGN KEY (`gameStatisticsIgdbId`) REFERENCES `game_statistics`(`igdbId`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 24:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` ADD CONSTRAINT `FK_d4a58817f04e0f6d8dc5dd9c5bc` FOREIGN KEY (`reviewStatisticsId`) REFERENCES `review_statistics`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 25:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` ADD CONSTRAINT `FK_290fa2cb2c806c07e630c1dd96d` FOREIGN KEY (`reviewStatisticsId`) REFERENCES `review_statistics`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 26:
                        _a.sent();
                        return [2];
                }
            });
        });
    };
    All1686449554435.prototype.down = function (queryRunner) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4, queryRunner.query("ALTER TABLE `review` DROP FOREIGN KEY `FK_290fa2cb2c806c07e630c1dd96d`")];
                    case 1:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` DROP FOREIGN KEY `FK_d4a58817f04e0f6d8dc5dd9c5bc`")];
                    case 2:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` DROP FOREIGN KEY `FK_03a68335a1e7de9daf07210b7e9`")];
                    case 3:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` DROP FOREIGN KEY `FK_69a61c8e75ea5b2d9affc23bd12`")];
                    case 4:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection_entry` DROP FOREIGN KEY `FK_4f24fd39e03d1586c1ddd7dee0e`")];
                    case 5:
                        _a.sent();
                        return [4, queryRunner.query("DROP INDEX `IDX_2d00614139fa7c316268aef68e` ON `user_like`")];
                    case 6:
                        _a.sent();
                        return [4, queryRunner.query("DROP INDEX `IDX_4ba7ead7dc31eb4ace08d7d775` ON `user_like`")];
                    case 7:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` CHANGE `reviewStatisticsId` `reviewStatisticsId` int NULL DEFAULT 'NULL'")];
                    case 8:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` DROP COLUMN `id`")];
                    case 9:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` ADD `id` varchar(36) NOT NULL")];
                    case 10:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` ADD PRIMARY KEY (`id`)")];
                    case 11:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `review` ADD CONSTRAINT `FK_290fa2cb2c806c07e630c1dd96d` FOREIGN KEY (`reviewStatisticsId`) REFERENCES `review_statistics`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 12:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` CHANGE `reviewStatisticsId` `reviewStatisticsId` int NULL DEFAULT 'NULL'")];
                    case 13:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` CHANGE `gameStatisticsIgdbId` `gameStatisticsIgdbId` int NULL DEFAULT 'NULL'")];
                    case 14:
                        _a.sent();
                        return [4, queryRunner.query("CREATE UNIQUE INDEX `IDX_4ba7ead7dc31eb4ace08d7d775` ON `user_like` (`userId`, `reviewStatisticsId`)")];
                    case 15:
                        _a.sent();
                        return [4, queryRunner.query("CREATE UNIQUE INDEX `IDX_2d00614139fa7c316268aef68e` ON `user_like` (`userId`, `gameStatisticsIgdbId`)")];
                    case 16:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` ADD CONSTRAINT `FK_d4a58817f04e0f6d8dc5dd9c5bc` FOREIGN KEY (`reviewStatisticsId`) REFERENCES `review_statistics`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 17:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `user_like` ADD CONSTRAINT `FK_03a68335a1e7de9daf07210b7e9` FOREIGN KEY (`gameStatisticsIgdbId`) REFERENCES `game_statistics`(`igdbId`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 18:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` DROP COLUMN `id`")];
                    case 19:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` ADD `id` varchar(36) NOT NULL")];
                    case 20:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` ADD PRIMARY KEY (`id`)")];
                    case 21:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection_entry` ADD CONSTRAINT `FK_4f24fd39e03d1586c1ddd7dee0e` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 22:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` DROP COLUMN `id`")];
                    case 23:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` ADD `id` varchar(36) NOT NULL")];
                    case 24:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `library` ADD PRIMARY KEY (`id`)")];
                    case 25:
                        _a.sent();
                        return [4, queryRunner.query("ALTER TABLE `collection` ADD CONSTRAINT `FK_69a61c8e75ea5b2d9affc23bd12` FOREIGN KEY (`libraryId`) REFERENCES `library`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION")];
                    case 26:
                        _a.sent();
                        return [2];
                }
            });
        });
    };
    return All1686449554435;
}());
exports.All1686449554435 = All1686449554435;
//# sourceMappingURL=1686449554435-all.js.map