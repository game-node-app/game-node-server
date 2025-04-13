import { Transform, Type } from "class-transformer";
import { applyDecorators } from "@nestjs/common";

export function ToBoolean() {
    return applyDecorators(
        Type(() => String),
        Transform(({ value }) => {
            return ["1", 1, "true", true].includes(value);
        }),
    );
}
