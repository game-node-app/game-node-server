import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsEntriesController } from "./collections-entries.controller";

describe("CollectionsEntriesController", () => {
    let controller: CollectionsEntriesController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CollectionsEntriesController],
        }).compile();

        controller = module.get<CollectionsEntriesController>(
            CollectionsEntriesController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
