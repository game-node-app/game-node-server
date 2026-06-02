import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { SupertokensConfigInjectionToken } from "./config.interface";
import { AUTH_ERRORS } from "./auth.constants";
import { UserInitService } from "../user/user-init/user-init.service";
import { UserAccountService } from "../user/user-account/user-account.service";
import { EMAIL_CONFIG_TOKEN } from "../global/global.tokens";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";

describe("AuthService", () => {
    let service: AuthService;
    let userAccountService: jest.Mocked<UserAccountService>;
    let userInitService: jest.Mocked<UserInitService>;

    beforeEach(async () => {
        jest.spyOn(supertokens, "init").mockImplementation(() => undefined);
        userAccountService = {
            getUsersByEmail: jest.fn(),
            getLinkedProvider: jest.fn(),
            linkAccounts: jest.fn(),
            unlinkAccount: jest.fn(),
        } as unknown as jest.Mocked<UserAccountService>;
        userInitService = {
            init: jest.fn(),
        } as unknown as jest.Mocked<UserInitService>;

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                {
                    provide: SupertokensConfigInjectionToken,
                    useValue: {
                        appInfo: {
                            appName: "GameNode",
                            apiDomain: "http://localhost",
                            websiteDomain: "http://localhost",
                        },
                        connectionURI: "http://localhost",
                        providers: [],
                    },
                },
                {
                    provide: UserInitService,
                    useValue: userInitService,
                },
                {
                    provide: UserAccountService,
                    useValue: userAccountService,
                },
                {
                    provide: EMAIL_CONFIG_TOKEN,
                    useValue: {},
                },
            ],
        }).compile();

        service = module.get(AuthService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe("handleThirdPartySignInUp", () => {
        const makeInput = (overrides?: Partial<any>) => ({
            provider: {
                id: "google",
                config: {},
                exchangeAuthCodeForOAuthTokens: jest
                    .fn()
                    .mockResolvedValue({ token: "t" }),
                getUserInfo: jest.fn().mockResolvedValue({
                    thirdPartyUserId: "tp-1",
                    email: { id: "user@example.com", isVerified: true },
                    rawUserInfoFromProvider: {},
                }),
            },
            tenantId: "public",
            options: { req: {}, res: {} },
            userContext: {},
            redirectURIInfo: {
                redirectURIOnProviderDashboard: "http://localhost",
                redirectURIQueryParams: {},
            },
            ...overrides,
        });

        it("links provider and creates session for existing user", async () => {
            const createSessionSpy = jest
                .spyOn(Session, "createNewSession")
                .mockResolvedValue({ handle: "session" } as any);
            userAccountService.getUsersByEmail.mockResolvedValue([
                {
                    id: "u1",
                    loginMethods: [
                        {
                            verified: true,
                            recipeUserId: "recipe-1",
                            hasSameEmailAs: () => true,
                        },
                    ],
                },
            ] as any);
            userAccountService.getLinkedProvider.mockResolvedValue(null);

            const response = await (service as any).handleThirdPartySignInUp(
                { signInUpPOST: jest.fn() },
                makeInput(),
            );

            expect(userAccountService.linkAccounts).toHaveBeenCalledWith(
                "u1",
                "google",
                "tp-1",
            );
            expect(createSessionSpy).toHaveBeenCalled();
            expect(response.status).toBe("OK");
        });
    });

    describe("unlinkProvider", () => {
        it("rejects unlinking when only one provider remains", async () => {
            userAccountService.getLinkedProviders.mockResolvedValue([
                {
                    providerId: "google",
                    providerUserId: "tp-1",
                },
            ] as any);

            await expect(
                service.unlinkProvider("user-1", "google"),
            ).rejects.toThrow("Cannot unlink the last remaining provider.");
        });

        it("rejects unlinking when provider is not linked", async () => {
            userAccountService.getLinkedProviders.mockResolvedValue([
                {
                    providerId: "google",
                    providerUserId: "tp-1",
                },
                {
                    providerId: "discord",
                    providerUserId: "tp-2",
                },
            ] as any);

            await expect(
                service.unlinkProvider("user-1", "twitter"),
            ).rejects.toThrow("Provider not linked.");
        });

        it("unlinks provider when more than one linked", async () => {
            userAccountService.getLinkedProviders.mockResolvedValue([
                {
                    providerId: "google",
                    providerUserId: "tp-1",
                },
                {
                    providerId: "discord",
                    providerUserId: "tp-2",
                },
            ] as any);

            await service.unlinkProvider("user-1", "discord");

            expect(userAccountService.unlinkAccount).toHaveBeenCalledWith(
                "discord",
                "tp-2",
            );
        });
    });
});
