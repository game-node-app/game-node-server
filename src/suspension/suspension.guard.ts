import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import Session from "supertokens-node/recipe/session";
import { SuspensionService } from "./suspension.service";

/**
 * This guard verifies if the current logged-in user's suspended or banned. <br>
 * <strong>The controller using this guard should have SuspensionModule imported in its module. </strong><br>
 * This depends on AuthGuard to work correctly, so make sure it comes first at the controller level. <br>
 * @see AuthGuard
 */
@Injectable()
export class SuspensionGuard implements CanActivate {
    constructor(private readonly suspensionService: SuspensionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Ignored for non-HTTP methods
        if (context.getType() !== "http") {
            return true;
        }
        const httpContext = context.switchToHttp();
        const request = httpContext.getRequest<Request>();
        const response = httpContext.getResponse<Response>();

        const session = await Session.getSession(request, response, {
            sessionRequired: false,
        });

        if (session) {
            const userId = session.getUserId();
            const isSuspended =
                await this.suspensionService.checkIsSuspendedOrBanned(userId);

            return !isSuspended;
        }

        return true;
    }
}
