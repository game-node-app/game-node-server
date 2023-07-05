import { AppInfo } from "supertokens-node/types";
export declare const ConfigInjectionToken = "ConfigInjectionToken";
export declare type AuthModuleConfig = {
    appInfo: AppInfo;
    connectionURI: string;
    apiKey?: string;
};
