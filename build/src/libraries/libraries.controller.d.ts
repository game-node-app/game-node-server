import { LibrariesService } from "./libraries.service";
import { SessionContainer } from "supertokens-node/recipe/session";
export declare class LibrariesController {
    private readonly librariesService;
    constructor(librariesService: LibrariesService);
    findByUserId(session: SessionContainer): Promise<import("./entities/library.entity").Library | null>;
    findById(id: string): Promise<import("./entities/library.entity").Library | null>;
}
