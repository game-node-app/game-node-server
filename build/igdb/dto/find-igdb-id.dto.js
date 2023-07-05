"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FindIgdbIdDto = void 0;
var openapi = require("@nestjs/swagger");
var swagger_1 = require("@nestjs/swagger");
var find_igdb_dto_1 = require("./find-igdb.dto");
var FindIgdbIdDto = (function (_super) {
    __extends(FindIgdbIdDto, _super);
    function FindIgdbIdDto() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    FindIgdbIdDto._OPENAPI_METADATA_FACTORY = function () {
        return { igdbIds: { required: true, type: function () { return [Number]; } } };
    };
    return FindIgdbIdDto;
}((0, swagger_1.OmitType)(find_igdb_dto_1.FindIgdbDto, ["search", "where"])));
exports.FindIgdbIdDto = FindIgdbIdDto;
//# sourceMappingURL=find-igdb-id.dto.js.map