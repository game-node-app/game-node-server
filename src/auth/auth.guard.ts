import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
} from "@nestjs/common";
import { Error as STError } from "supertokens-node";

import { verifySession } from "supertokens-node/recipe/session/framework/express";
import { Reflector } from "@nestjs/core";
import UserRoles from "supertokens-node/recipe/userroles";

/**
 * Default AuthGuard that checks for a valid session.
 * Use 'Public()' decorator to bypass authentication
 * (session info will still be available if user is logged in)
 * <br>
 * This guard should not be used for microservice communication, prefer JwtAuthGuard instead.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    private readonly logger = new Logger(AuthGuard.name);

    constructor(private readonly reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctxType = context.getType<"http" | "rmq">();

        if (ctxType === "rmq") {
            this.logger.warn(
                `Warning: AuthGuard can't be used in a RabbitMQ service/handler`,
            );

            return true;
        }

        const ctx = context.switchToHttp();

        let err = undefined;
        const resp = ctx.getResponse();

        const isPublic = this.reflector.get<boolean>(
            "isPublic",
            context.getHandler(),
        );

        const requiredRoles = this.reflector.get<string[] | undefined>(
            "roles",
            context.getHandler(),
        );

        // You can create an optional version of this by passing {sessionRequired: false} to verifySession
        await verifySession({
            sessionRequired: !isPublic,
            /**
             * Override Supertokens validators to use UserRole validation logic.
             * @param globalClaimValidators
             */
            overrideGlobalClaimValidators: (globalClaimValidators) => {
                const validators = [...globalClaimValidators];
                if (requiredRoles && requiredRoles.length > 0) {
                    for (const role of requiredRoles) {
                        validators.push(
                            UserRoles.UserRoleClaim.validators.includes(role),
                        );
                    }
                }

                return validators;
            },
        })(ctx.getRequest(), resp, (res) => {
            err = res;
        });

        if (resp.headersSent) {
            throw new STError({
                message: "RESPONSE_SENT",
                type: "RESPONSE_SENT",
            });
        }

        if (err) {
            throw err;
        }

        return true;
    }
}
