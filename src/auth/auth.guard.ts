import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Error as STError } from "supertokens-node";

import { verifySession } from "supertokens-node/recipe/session/framework/express";
import { Reflector } from "@nestjs/core";

/**
 * Default AuthGuard that checks for a valid session.
 * Use 'Public()' decorator to bypass authentication
 * (session info will still be available if user is logged in)
 * <br>
 * This guard should not be used for microservice communication, prefer JwtAuthGuard instead.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctx = context.switchToHttp();

        let err = undefined;
        const resp = ctx.getResponse();

        const isPublic = this.reflector.get<boolean>(
            "isPublic",
            context.getHandler(),
        );
        console.log("isPublic: ", isPublic);

        // You can create an optional version of this by passing {sessionRequired: false} to verifySession
        await verifySession({
            sessionRequired: !isPublic,
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
