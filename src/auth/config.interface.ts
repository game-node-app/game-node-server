import { AppInfo } from "supertokens-node/types";

export const SupertokensConfigInjectionToken = "ConfigInjectionToken";

export type AuthModuleConfig = {
    appInfo: AppInfo;
    connectionURI: string;
    apiKey?: string;
};
