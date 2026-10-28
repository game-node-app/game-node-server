import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ImporterBatchImportRequestDto } from "./importer-batch-import-request.dto";

describe("batch import selection", () => {
    it.each([
        {},
        { externalGameIds: [] },
        { importAll: true, externalGameIds: [1] },
        { externalGameIds: [0] },
        { externalGameIds: [1.5] },
        { externalGameIds: [1], status: "invalid" },
        { importAll: "true" },
    ])("rejects invalid input %o", async (input) => {
        const dto = plainToInstance(ImporterBatchImportRequestDto, input, {
            enableImplicitConversion: true,
        });
        expect(await validate(dto)).not.toHaveLength(0);
    });
    it.each([{ importAll: true }, { externalGameIds: [1, 1] }])(
        "accepts a valid selection %o",
        async (input) => {
            const dto = plainToInstance(ImporterBatchImportRequestDto, input, {
                enableImplicitConversion: true,
            });
            expect(await validate(dto)).toHaveLength(0);
        },
    );
});
