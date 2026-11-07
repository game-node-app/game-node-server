import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { Public } from "../auth/public.decorator";
import { Session, SessionContainer } from "../auth/session.decorator";
import { BillingService } from "./billing.service";
import {
    CheckoutRequestDto,
    PortalRequestDto,
} from "./dto/billing-request.dto";
import {
    BillingCheckoutResponseDto,
    BillingMeResponseDto,
    BillingOffersResponseDto,
    BillingPortalResponseDto,
    BillingSubscriptionActionResponseDto,
} from "./dto/billing-response.dto";

@Controller("billing")
@ApiTags("billing")
@UseGuards(AuthGuard)
export class BillingController {
    constructor(private readonly billingService: BillingService) {}

    @Get("offers")
    @Public()
    @ApiOkResponse({ type: BillingOffersResponseDto })
    getOffers(
        @Headers("cf-ipcountry") country: string | undefined,
        @Headers("accept-language") acceptLanguage: string | undefined,
    ): BillingOffersResponseDto {
        return this.billingService.getOffers(country, acceptLanguage);
    }

    @Post("checkout")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: BillingCheckoutResponseDto })
    createCheckout(
        @Session() session: SessionContainer,
        @Body() dto: CheckoutRequestDto,
        @Req() req: Request,
    ): Promise<BillingCheckoutResponseDto> {
        return this.billingService.createCheckout(
            session.getUserId(),
            dto,
            req.headers,
        );
    }

    @Get("me")
    @ApiOkResponse({ type: BillingMeResponseDto })
    getMe(@Session() session: SessionContainer): Promise<BillingMeResponseDto> {
        return this.billingService.getMe(session.getUserId());
    }

    @Post("portal")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: BillingPortalResponseDto })
    createPortal(
        @Session() session: SessionContainer,
        @Body() dto: PortalRequestDto,
        @Req() req: Request,
    ): Promise<BillingPortalResponseDto> {
        return this.billingService.createPortal(
            session.getUserId(),
            dto,
            req.headers,
        );
    }

    @Post("cancel")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: BillingSubscriptionActionResponseDto })
    cancel(
        @Session() session: SessionContainer,
    ): Promise<BillingSubscriptionActionResponseDto> {
        return this.billingService.cancel(session.getUserId());
    }

    @Post("restore")
    @HttpCode(HttpStatus.OK)
    @ApiOkResponse({ type: BillingSubscriptionActionResponseDto })
    restore(
        @Session() session: SessionContainer,
    ): Promise<BillingSubscriptionActionResponseDto> {
        return this.billingService.restore(session.getUserId());
    }
}
