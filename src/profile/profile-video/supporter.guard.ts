import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from "@nestjs/common";
import { BillingService } from "../../billing/billing.service";
import { SessionContainer } from "../../auth/session.decorator";

/** Guards run before Multer, so a non-supporter never writes an upload to disk. */
@Injectable()
export class SupporterGuard implements CanActivate {
    constructor(private readonly billingService: BillingService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{
            session?: SessionContainer;
        }>();
        const userId = request.session?.getUserId();
        if (!userId || !(await this.billingService.isSupporter(userId))) {
            throw new ForbiddenException();
        }
        return true;
    }
}
