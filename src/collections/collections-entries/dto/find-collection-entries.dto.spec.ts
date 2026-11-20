import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { DECORATORS } from "@nestjs/swagger/dist/constants";
import { FindCollectionEntriesDto } from "./find-collection-entries.dto";
import { FindCollectionEntriesForCollectionIdDto } from "./find-collection-entries-for-collection-id.dto";

// Mirrors main.ts: ValidationPipe({ transform, enableImplicitConversion }).
const pipe = new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
});

function transform(
    value: unknown,
    type: "body" | "query" = "body",
): Promise<FindCollectionEntriesDto> {
    return pipe.transform(value, {
        type,
        metatype:
            type === "body"
                ? FindCollectionEntriesForCollectionIdDto
                : FindCollectionEntriesDto,
    }) as Promise<FindCollectionEntriesDto>;
}

describe("FindCollectionEntriesDto search", () => {
    it.each(["body", "query"] as const)(
        "accepts 256 characters in the %s",
        async (type) => {
            const search = "a".repeat(256);
            const dto = await transform({ search }, type);

            expect(dto.search).toBe(search);
        },
    );

    it("rejects 257 whitespace characters with 400", async () => {
        await expect(
            transform({ search: " ".repeat(257) }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(["body", "query"] as const)(
        "rejects 257 characters in the %s with 400",
        async (type) => {
            await expect(
                transform({ search: "a".repeat(257) }, type),
            ).rejects.toBeInstanceOf(BadRequestException);
        },
    );

    it.each(["", "   "])("turns blank %p into undefined", async (search) => {
        const dto = await transform({ search });

        expect(dto.search).toBeUndefined();
    });

    it.each([null, 123, true, ["a"], { term: "a" }])(
        "rejects the non-string POST value %p instead of stringifying it",
        async (search) => {
            await expect(transform({ search })).rejects.toBeInstanceOf(
                BadRequestException,
            );
        },
    );

    it("documents an optional string of at most 256 characters", () => {
        const schema = Reflect.getMetadata(
            DECORATORS.API_MODEL_PROPERTIES,
            FindCollectionEntriesDto.prototype,
            "search",
        );

        expect(schema).toMatchObject({
            type: String,
            required: false,
            maxLength: 256,
        });
    });
});
