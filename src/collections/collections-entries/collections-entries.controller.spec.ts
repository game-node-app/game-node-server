import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsEntriesController } from "./collections-entries.controller";
import { CollectionsEntriesService } from "./collections-entries.service";
import { AuthService } from "../../auth/auth.service";

describe("CollectionsEntriesController", () => {
    let controller: CollectionsEntriesController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CollectionsEntriesController],
            providers: [
                { provide: AuthService, useValue: {} },
                {
                    provide: CollectionsEntriesService,
                    useValue: {},
                },
            ],
        }).compile();

        controller = module.get<CollectionsEntriesController>(
            CollectionsEntriesController,
        );
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });
});
