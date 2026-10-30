import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "./auth.service";
import { SupertokensConfigInjectionToken } from "./config.interface";
import { UserInitService } from "../user/user-init/user-init.service";
import { UserAccountService } from "../user/user-account/user-account.service";
import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import ThirdParty from "supertokens-node/recipe/thirdparty";
import Passwordless from "supertokens-node/recipe/passwordless";

describe("AuthService", () => {
    let service: AuthService;
    let userAccountService: jest.Mocked<UserAccountService>;
    let userInitService: jest.Mocked<UserInitService>;
    let thirdPartyInit: jest.SpyInstance;
    let passwordlessInit: jest.SpyInstance;

    beforeEach(async () => {
        jest.spyOn(supertokens, "init").mockImplementation(() => undefined);
        thirdPartyInit = jest.spyOn(ThirdParty, "init");
        passwordlessInit = jest.spyOn(Passwordless, "init");
        userAccountService = {
            getUsersByEmail: jest.fn(),
            getLinkedProvider: jest.fn(),
            getLinkedProviders: jest.fn(),
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
            ],
        }).compile();

        service = module.get(AuthService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("does not enable passwordless login", () => {
        expect(passwordlessInit).not.toHaveBeenCalled();
    });

    describe("third-party sign-in", () => {
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

            const apis = thirdPartyInit.mock.calls[0][0].override.apis({
                signInUpPOST: jest.fn(),
            });
            const response = await apis.signInUpPOST(makeInput());

            expect(userAccountService.linkAccounts).toHaveBeenCalledWith(
                "u1",
                "google",
                "tp-1",
            );
            expect(createSessionSpy).toHaveBeenCalled();
            expect(response.status).toBe("OK");
        });
    });

    describe("third-party sign-up", () => {
        const makeSignUpInput = (isVerified: boolean) => ({
            provider: {
                id: "google",
                config: {},
                exchangeAuthCodeForOAuthTokens: jest
                    .fn()
                    .mockResolvedValue({ token: "t" }),
                getUserInfo: jest.fn().mockResolvedValue({
                    thirdPartyUserId: "tp-1",
                    email: { id: "user@example.com", isVerified },
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
        });

        const signUp = async (input: any, existingUsers: any[]) => {
            userAccountService.getUsersByEmail.mockResolvedValue(
                existingUsers as any,
            );
            userAccountService.getLinkedProvider.mockResolvedValue(null);
            const original = jest.fn().mockResolvedValue({
                status: "OK",
                user: { id: "new-user" },
            });
            const apis = thirdPartyInit.mock.calls[0][0].override.apis({
                signInUpPOST: original,
            });
            await apis.signInUpPOST(input);
            return original;
        };

        it("passes tokens without redirectURIInfo to avoid exchanging the code twice", async () => {
            const input = makeSignUpInput(true);
            const original = await signUp(input, []);

            const forwarded = original.mock.calls[0][0];
            expect(forwarded.redirectURIInfo).toBeUndefined();
            expect(forwarded.oAuthTokens).toEqual({ token: "t" });
            expect(
                input.provider.exchangeAuthCodeForOAuthTokens,
            ).toHaveBeenCalledTimes(1);
            expect(userInitService.init).toHaveBeenCalledWith("new-user");
        });

        it("creates a separate account instead of linking when the email is unverified", async () => {
            const original = await signUp(makeSignUpInput(false), [
                { id: "u1", loginMethods: [] },
            ]);

            expect(userAccountService.linkAccounts).not.toHaveBeenCalled();
            expect(original).toHaveBeenCalledTimes(1);
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

        it("does not count retired email login as a remaining provider", async () => {
            userAccountService.getLinkedProviders.mockResolvedValue([
                { providerId: "google", providerUserId: "tp-1" },
                { providerId: "passwordless", providerUserId: "email-1" },
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
