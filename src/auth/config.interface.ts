import { AppInfo } from "supertokens-node/types";
import { SMTPServiceConfig } from "supertokens-node/lib/build/ingredients/emaildelivery/services/smtp";
import { ProviderInput } from "supertokens-node/lib/build/recipe/thirdparty/types";

export const SupertokensConfigInjectionToken = "ConfigInjectionToken";

export type AuthModuleConfig = {
    appInfo: AppInfo;
    connectionURI: string;
    apiKey?: string;
    smtpSettings: SMTPServiceConfig;
    providers: ProviderInput[];
};
