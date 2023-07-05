import { AppService } from "./app.service";
import { SessionContainer } from "supertokens-node/recipe/session";
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHello(): string;
    getTest(session: SessionContainer): Promise<string>;
}
