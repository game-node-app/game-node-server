import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Retrieves session info for the current logged in user. <br>
 * Needs to be used with AuthGuard. <br>
 * If the 'Public' decorator is also used, the 'session' object will be null if the user is not logged in.
 * @see AuthGuard
 * @see Public
 */
export const Session = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request.session;
    },
);
