import { Transform, Type } from "class-transformer";
import { applyDecorators } from "@nestjs/common";

/**
 * Custom decorator that correctly matches a request parameter to a boolean value.
 * Can be used in GET (url, get params) and POST (request body) dtos alike
 * @constructor
 */
export function ToBoolean() {
    return applyDecorators(
        Type(() => String),
        Transform(({ value }) => {
            return ["1", 1, "true", true].includes(value);
        }),
    );
}
