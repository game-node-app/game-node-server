import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { StatisticsBatchSummaryRequestDto } from "./statistics-api.dto";

const strictValidation = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
});

const parse = async (input: unknown) =>
    strictValidation.transform(input, {
        type: "body",
        metatype: StatisticsBatchSummaryRequestDto,
    });

describe("batch statistics summary validation", () => {
    const contentIds = [
        "123e4567-e89b-42d3-a456-426614174000",
        "223e4567-e89b-42d3-a456-426614174000",
    ];

    it("accepts native ids matching the source type", async () => {
        await expect(parse({ sourceType: "game", sourceIds: [1, 2] })).resolves.toMatchObject({
            sourceType: "game",
            sourceIds: [1, 2],
        });
        await expect(parse({ sourceType: "review", sourceIds: contentIds })).resolves.toMatchObject({
            sourceType: "review",
            sourceIds: contentIds,
        });
        await expect(parse({ sourceType: "game", sourceIds: ["5"] })).resolves.toMatchObject({
            sourceIds: [5],
        });
    });

    it.each([
        ["an empty id array", { sourceType: "game", sourceIds: [] }],
        [
            "more than 100 ids",
            {
                sourceType: "game",
                sourceIds: Array.from({ length: 101 }, (_, index) => index + 1),
            },
        ],
        ["a UUID for a game", { sourceType: "game", sourceIds: [contentIds[0]] }],
        ["a number for content", { sourceType: "review", sourceIds: [1] }],
        ["a non-positive game id", { sourceType: "game", sourceIds: [0] }],
        ["a fractional game id", { sourceType: "game", sourceIds: [1.5] }],
        ["an invalid UUID", { sourceType: "post", sourceIds: ["not-a-uuid"] }],
        ["a non-array payload", { sourceType: "review", sourceIds: contentIds[0] }],
        ["an unsupported source type", { sourceType: "unsupported", sourceIds: contentIds }],
        ["a missing source type", { sourceIds: contentIds }],
        [
            "an unknown property",
            { sourceType: "review", sourceIds: contentIds, targetUserId: "forged" },
        ],
    ])("rejects %s", async (_label, input) => {
        await expect(parse(input)).rejects.toBeInstanceOf(BadRequestException);
    });
});
