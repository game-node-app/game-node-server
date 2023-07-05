import { AuthModuleConfig } from "./config.interface";
import { CollectionsService } from "../collections/collections.service";
import { LibrariesService } from "../libraries/libraries.service";
export declare class AuthService {
    private config;
    private collectionsService;
    private librariesService;
    private logger;
    constructor(config: AuthModuleConfig, collectionsService: CollectionsService, librariesService: LibrariesService);
    initUser(userId: string): Promise<void>;
}
