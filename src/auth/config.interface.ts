import { AppInfo } from "supertokens-node/types";
import { ProviderInput } from "supertokens-node/lib/build/recipe/thirdparty/types";

export const SupertokensConfigInjectionToken = "ConfigInjectionToken";

export type SupertokensConfig = {
    appInfo: AppInfo;
    connectionURI: string;
    apiKey?: string;
    providers: ProviderInput[];
};
