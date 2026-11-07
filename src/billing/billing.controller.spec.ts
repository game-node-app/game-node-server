import {
    ConflictException,
    ExecutionContext,
    INestApplication,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
    ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthGuard } from "../auth/auth.guard";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";

describe("BillingController", () => {
    let app: INestApplication;
    let authenticated = true;
    const billing = {
        getOffers: jest.fn(),
        createCheckout: jest.fn(),
        getMe: jest.fn(),
        createPortal: jest.fn(),
        cancel: jest.fn(),
        restore: jest.fn(),
    };

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [BillingController],
            providers: [{ provide: BillingService, useValue: billing }],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate(context: ExecutionContext) {
                    const req = context.switchToHttp().getRequest();
                    if (req.path === "/billing/offers") return true;
                    if (!authenticated) throw new UnauthorizedException();
                    req.session = { getUserId: () => "user-1" };
                    return true;
                },
            })
            .compile();

        app = module.createNestApplication();
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    beforeEach(() => {
        jest.resetAllMocks();
        authenticated = true;
    });

    afterAll(async () => app.close());

    it("serves offers publicly with the requested currency", async () => {
        authenticated = false;
        const body = {
            currency: "BRL",
            offers: [
                {
                    plan: "supporter",
                    interval: "monthly",
                    amount: 990,
                    displayAmount: "R$ 9,90",
                },
            ],
        };
        billing.getOffers.mockReturnValue(body);

        await request(app.getHttpServer())
            .get("/billing/offers")
            .set("CF-IPCountry", "BR")
            .expect(200, body);

        expect(billing.getOffers).toHaveBeenCalledWith("BR", undefined);
    });

    it("requires authentication for checkout", async () => {
        authenticated = false;

        await request(app.getHttpServer())
            .post("/billing/checkout")
            .send({ interval: "monthly" })
            .expect(401);

        expect(billing.createCheckout).not.toHaveBeenCalled();
    });

    it("rejects an unknown interval", async () => {
        await request(app.getHttpServer())
            .post("/billing/checkout")
            .send({ interval: "weekly" })
            .expect(400);

        expect(billing.createCheckout).not.toHaveBeenCalled();
    });

    it("ignores extra price fields on checkout", async () => {
        billing.createCheckout.mockResolvedValue({
            url: "https://checkout.test",
        });

        await request(app.getHttpServer())
            .post("/billing/checkout")
            .send({
                interval: "monthly",
                priceId: "price_123",
                amount: 1,
                currency: "EUR",
            })
            .expect(200, { url: "https://checkout.test" });

        expect(billing.createCheckout).toHaveBeenCalledWith(
            "user-1",
            expect.objectContaining({ interval: "monthly" }),
            expect.any(Object),
        );
    });

    it("maps an existing subscription to 409", async () => {
        billing.createCheckout.mockRejectedValue(new ConflictException());

        await request(app.getHttpServer())
            .post("/billing/checkout")
            .send({ interval: "monthly" })
            .expect(409);
    });

    it("maps a disabled Stripe integration to 503", async () => {
        billing.createCheckout.mockRejectedValue(
            new ServiceUnavailableException(),
        );

        await request(app.getHttpServer())
            .post("/billing/checkout")
            .send({ interval: "monthly" })
            .expect(503);
    });

    it("returns the caller's billing status", async () => {
        const body = {
            isSupporter: true,
            status: "active",
            plan: "supporter",
            billingInterval: "month",
            periodEnd: "2026-12-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
        };
        billing.getMe.mockResolvedValue(body);

        await request(app.getHttpServer()).get("/billing/me").expect(200, body);

        expect(billing.getMe).toHaveBeenCalledWith("user-1");
    });

    it("maps a missing Stripe customer to 404 on portal", async () => {
        billing.createPortal.mockRejectedValue(new NotFoundException());

        await request(app.getHttpServer())
            .post("/billing/portal")
            .send({})
            .expect(404);
    });

    it("cancels the caller's subscription at period end", async () => {
        const body = {
            status: "active",
            cancelAtPeriodEnd: true,
            periodEnd: "2026-12-01T00:00:00.000Z",
        };
        billing.cancel.mockResolvedValue(body);

        await request(app.getHttpServer())
            .post("/billing/cancel")
            .expect(200, body);

        expect(billing.cancel).toHaveBeenCalledWith("user-1");
    });

    it("maps a restore without pending cancellation to 409", async () => {
        billing.restore.mockRejectedValue(new ConflictException());

        await request(app.getHttpServer()).post("/billing/restore").expect(409);
    });
});
