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
exports.UpdateReviewDto = void 0;
var openapi = require("@nestjs/swagger");
var swagger_1 = require("@nestjs/swagger");
var create_review_dto_1 = require("./create-review.dto");
var UpdateReviewDto = (function (_super) {
    __extends(UpdateReviewDto, _super);
    function UpdateReviewDto() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    UpdateReviewDto._OPENAPI_METADATA_FACTORY = function () {
        return {};
    };
    return UpdateReviewDto;
}((0, swagger_1.PartialType)(create_review_dto_1.CreateReviewDto)));
exports.UpdateReviewDto = UpdateReviewDto;
//# sourceMappingURL=update-review.dto.js.map