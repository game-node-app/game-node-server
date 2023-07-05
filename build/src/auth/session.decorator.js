"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
var common_1 = require("@nestjs/common");
exports.Session = (0, common_1.createParamDecorator)(function (data, ctx) {
    var request = ctx.switchToHttp().getRequest();
    return request.session;
});
//# sourceMappingURL=session.decorator.js.map