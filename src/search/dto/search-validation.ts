import {
    BadRequestException,
    Injectable,
    PipeTransform,
} from "@nestjs/common";
import { Transform } from "class-transformer";
import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";
import {
    EGameCategory,
    EGameStatus,
} from "../../game/game-repository/game-repository.constants";
import {
    SEARCH_DEFAULT_LIMIT,
    SEARCH_DEFAULT_PAGE,
    SEARCH_MAX_FILTER_ARRAY_LENGTH,
    SEARCH_MAX_FILTER_STRING_LENGTH,
    SEARCH_MAX_LIMIT,
    SEARCH_MAX_OFFSET,
    SEARCH_MAX_QUERY_LENGTH,
} from "../search.constants";

export const VALID_GAME_CATEGORY_VALUES = new Set<number>(
    Object.values(EGameCategory).filter(
        (v): v is number => typeof v === "number",
    ),
);

export const VALID_GAME_STATUS_VALUES = new Set<number>(
    Object.values(EGameStatus).filter(
        (v): v is number => typeof v === "number",
    ),
);

/**
 * Preserves the raw property value from the source JSON object so the global
 * ValidationPipe's `enableImplicitConversion: true` does not coerce types.
 */
export function PreserveRawValue(): PropertyDecorator {
    return Transform(({ obj, key }) => {
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            return (obj as Record<string, unknown>)[String(key)];
        }
        return undefined;
    });
}

export function IsStrictOptionalQuery(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictOptionalQuery",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (value === undefined) {
                        return true;
                    }
                    return (
                        typeof value === "string" &&
                        value.length <= SEARCH_MAX_QUERY_LENGTH
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a string of at most ${SEARCH_MAX_QUERY_LENGTH} characters`;
                },
            },
        });
    };
}

export function IsStrictRequiredNonBlankQuery(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictRequiredNonBlankQuery",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    return (
                        typeof value === "string" &&
                        value.trim().length > 0 &&
                        value.length <= SEARCH_MAX_QUERY_LENGTH
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a nonblank string of at most ${SEARCH_MAX_QUERY_LENGTH} characters`;
                },
            },
        });
    };
}

export function IsStrictEnumIntArray(
    allowedValues: ReadonlySet<number>,
    label: string,
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: `isStrictEnumIntArray_${label}`,
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (value === undefined) {
                        return true;
                    }
                    if (
                        !Array.isArray(value) ||
                        value.length > SEARCH_MAX_FILTER_ARRAY_LENGTH
                    ) {
                        return false;
                    }
                    return value.every(
                        (item) =>
                            typeof item === "number" &&
                            Number.isInteger(item) &&
                            allowedValues.has(item),
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be an array of at most ${SEARCH_MAX_FILTER_ARRAY_LENGTH} valid ${label} enum integers`;
                },
            },
        });
    };
}

export function IsStrictFilterStringArray(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictFilterStringArray",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (value === undefined) {
                        return true;
                    }
                    if (
                        !Array.isArray(value) ||
                        value.length > SEARCH_MAX_FILTER_ARRAY_LENGTH
                    ) {
                        return false;
                    }
                    return value.every(
                        (item) =>
                            typeof item === "string" &&
                            item.length <= SEARCH_MAX_FILTER_STRING_LENGTH,
                    );
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be an array of at most ${SEARCH_MAX_FILTER_ARRAY_LENGTH} strings (each at most ${SEARCH_MAX_FILTER_STRING_LENGTH} characters)`;
                },
            },
        });
    };
}

export function IsStrictSearchLimit(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictSearchLimit",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    if (value === undefined) {
                        return isOffsetWithinBounds(args.object as Record<string, unknown>);
                    }
                    if (
                        typeof value !== "number" ||
                        !Number.isInteger(value) ||
                        !Number.isSafeInteger(value)
                    ) {
                        return false;
                    }
                    if (value !== 0 && (value < 1 || value > SEARCH_MAX_LIMIT)) {
                        return false;
                    }
                    return isOffsetWithinBounds(args.object as Record<string, unknown>);
                },
                defaultMessage() {
                    return `limit must be an integer between 1 and ${SEARCH_MAX_LIMIT} (or 0/omitted for default ${SEARCH_DEFAULT_LIMIT}) with effective offset at most ${SEARCH_MAX_OFFSET}`;
                },
            },
        });
    };
}

export function IsStrictSearchPage(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictSearchPage",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    if (value === undefined) {
                        return isOffsetWithinBounds(args.object as Record<string, unknown>);
                    }
                    if (
                        typeof value !== "number" ||
                        !Number.isInteger(value) ||
                        !Number.isSafeInteger(value)
                    ) {
                        return false;
                    }
                    if (value !== 0 && value < 1) {
                        return false;
                    }
                    return isOffsetWithinBounds(args.object as Record<string, unknown>);
                },
                defaultMessage() {
                    return `page must be a positive integer (or 0/omitted for default ${SEARCH_DEFAULT_PAGE}) with effective offset ((page - 1) * limit) at most ${SEARCH_MAX_OFFSET}`;
                },
            },
        });
    };
}

export function IsStrictOptionalBoolean(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return (target: object, propertyName: string | symbol) => {
        registerDecorator({
            name: "isStrictOptionalBoolean",
            target: target.constructor,
            propertyName: String(propertyName),
            options: validationOptions,
            validator: {
                validate(value: unknown) {
                    if (value === undefined) {
                        return true;
                    }
                    return typeof value === "boolean";
                },
                defaultMessage(args: ValidationArguments) {
                    return `${args.property} must be a boolean`;
                },
            },
        });
    };
}

export function resolveEffectivePagination(dto: {
    page?: number;
    limit?: number;
}): { page: number; limit: number; offset: number } {
    const page =
        dto.page === undefined || dto.page === 0
            ? SEARCH_DEFAULT_PAGE
            : dto.page;
    const limit =
        dto.limit === undefined || dto.limit === 0
            ? SEARCH_DEFAULT_LIMIT
            : dto.limit;
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

function isOffsetWithinBounds(obj: Record<string, unknown>): boolean {
    const rawPage = obj?.page;
    const rawLimit = obj?.limit;

    const page =
        rawPage === undefined || rawPage === 0 ? SEARCH_DEFAULT_PAGE : rawPage;
    const limit =
        rawLimit === undefined || rawLimit === 0
            ? SEARCH_DEFAULT_LIMIT
            : rawLimit;

    if (
        typeof page !== "number" ||
        !Number.isInteger(page) ||
        !Number.isSafeInteger(page) ||
        page < 1
    ) {
        return false;
    }
    if (
        typeof limit !== "number" ||
        !Number.isInteger(limit) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > SEARCH_MAX_LIMIT
    ) {
        return false;
    }

    const offset = (page - 1) * limit;
    return (
        Number.isSafeInteger(offset) &&
        offset >= 0 &&
        offset <= SEARCH_MAX_OFFSET
    );
}

@Injectable()
export class StrictSearchBodyPipe implements PipeTransform {
    transform(value: unknown) {
        if (
            value === null ||
            value === undefined ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            throw new BadRequestException("Request body must be a JSON object");
        }
        return value;
    }
}
