import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthService } from "./auth.service";

type BetterAuthSession = NonNullable<
    Awaited<ReturnType<AuthService["getSession"]>>
>;

/**
 * What {@link AuthGuard} puts on req.session for a signed-in user.
 */
export type SessionContainer = BetterAuthSession & {
    getUserId: () => string;
};

/**
 * Retrieves session info for the current logged in user. <br>
 * Needs to be used with {@link AuthGuard}. <br>
 * If the 'Public' decorator is also used, the 'session' object will be null if the user is not logged in.
 * @see AuthGuard
 * @see Public
 */
export const Session = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const ctxType = ctx.getType();
        if (ctxType === "http") {
            const request = ctx.switchToHttp().getRequest();
            return request.session;
        }
    },
);
