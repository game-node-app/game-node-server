import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService, parseRoles } from "./auth.service";
import { SessionContainer } from "./session.decorator";

/**
 * Default AuthGuard that checks for a valid session (Better Auth cookie or Authorization: Bearer token).
 * Use 'Public()' decorator to bypass authentication
 * (session info will still be available if user is logged in)
 */
@Injectable()
export class AuthGuard implements CanActivate {
    private readonly logger = new Logger(AuthGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly authService: AuthService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType<"http" | "rmq">();

        if (ctxType !== "http") {
            this.logger.warn(
                `Warning: AuthGuard can't be used in a non-HTTP context!`,
            );

            return true;
        }

        const request = context.switchToHttp().getRequest();

        const isPublic = this.reflector.get<boolean>(
            "isPublic",
            context.getHandler(),
        );

        const requiredRoles = this.reflector.get<string[] | undefined>(
            "roles",
            context.getHandler(),
        );

        const result = await this.authService.getSession(request);

        if (!result) {
            if (isPublic) return true;
            throw new UnauthorizedException();
        }

        request.session = {
            ...result,
            getUserId: () => result.user.id,
        } satisfies SessionContainer;

        if (requiredRoles && requiredRoles.length > 0) {
            const roles = parseRoles(result.user.role);
            if (!requiredRoles.some((role) => roles.includes(role))) {
                throw new ForbiddenException();
            }
        }

        return true;
    }
}
